import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"

// The Health Connect and phone-calendar auto-syncs listened only for
// visibilitychange. A cold start has no such event — the page is born
// visible — and Samsung kills the backgrounded app routinely. So the most
// common morning (tap the icon, read the dashboard, swipe it away) never
// synced at all: steps, the phone's sleep and a weigh-in stayed missing until
// some later session happened to background and resume the app.
//
// The fix syncs once as soon as the source says it is ready, and holds a
// second sync off while the first is still running — the throttle stamp is
// written only after success, so without that a resume during the first
// 30-day read would start another.

const doc = vi.hoisted(() => ({
  visibilityState: "visible" as "visible" | "hidden",
  listeners: [] as (() => void)[],
}))

function fire() { for (const l of doc.listeners) l() }

beforeEach(() => {
  doc.visibilityState = "visible"
  doc.listeners = []
  const store = new Map<string, string>()
  vi.stubGlobal("document", {
    get visibilityState() { return doc.visibilityState },
    addEventListener: (_: string, l: () => void) => { doc.listeners.push(l) },
    removeEventListener: (_: string, l: () => void) => { doc.listeners = doc.listeners.filter(x => x !== l) },
  })
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

import { syncOnForeground } from "@/lib/foreground-sync"

const flush = () => new Promise(r => setTimeout(r, 0))

describe("syncOnForeground", () => {
  it("syncs on a cold start, with no visibilitychange at all", async () => {
    const sync = vi.fn(async () => {})
    syncOnForeground({ ready: async () => true, sync, storageKey: "k", throttleMs: 3_600_000 })
    await flush()
    expect(sync, "a cold open never synced — only a resume did").toHaveBeenCalledTimes(1)
  })

  it("does not start a second sync while the first is still running", async () => {
    let finish!: () => void
    const sync = vi.fn(() => new Promise<void>(r => { finish = r }))
    syncOnForeground({ ready: async () => true, sync, storageKey: "k", throttleMs: 3_600_000 })
    await flush()
    fire(); fire()
    await flush()
    expect(sync).toHaveBeenCalledTimes(1)
    finish()
    await flush()
    fire()
    await flush()
    expect(sync, "the throttle no longer holds after a completed sync").toHaveBeenCalledTimes(1)
  })

  it("never syncs when the source is not ready", async () => {
    const sync = vi.fn(async () => {})
    syncOnForeground({ ready: async () => false, sync, storageKey: "k", throttleMs: 1 })
    await flush()
    fire()
    await flush()
    expect(sync).not.toHaveBeenCalled()
  })

  it("does nothing after it has been torn down", async () => {
    const sync = vi.fn(async () => {})
    let ready!: (v: boolean) => void
    const stop = syncOnForeground({
      ready: () => new Promise<boolean>(r => { ready = r }), sync, storageKey: "k", throttleMs: 1,
    })
    stop()
    ready(true)
    await flush()
    expect(sync).not.toHaveBeenCalled()
  })
})

describe("both auto-syncs go through it", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it.each(["src/components/HealthConnectAutoSync.tsx", "src/components/DeviceCalendarAutoSync.tsx"])(
    "%s",
    f => {
      const src = stripped(f)
      expect(src).toMatch(/syncOnForeground\(/)
      expect(src, `${f} wires its own visibilitychange listener again, which never fires on a cold start.`)
        .not.toMatch(/addEventListener\(\s*["']visibilitychange/)
    },
  )

  it("Health Connect syncs only when at least one type is granted", () => {
    // A phone with Health Connect installed but never connected would
    // otherwise run the read (and write a sync outcome) every hour.
    const src = stripped("src/components/HealthConnectAutoSync.tsx")
    expect(src).toMatch(/permissionsByType\(/)
    expect(src).toMatch(/granted\.length/)
  })
})
