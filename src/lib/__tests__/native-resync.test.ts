/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The phone's alarms are rebuilt from the server on every foreground: cancel
// everything pending, fetch reminders, habits, doses, events and the nudge
// prefs, lay the lot down again. Three ways that went quietly wrong:
//
//  - A fetch that failed (no signal, a 500, an expired session) read as an
//    empty list. The rebuild then cancelled every dose and habit alarm and put
//    back only the daily nudges — including a noon nudge the user had switched
//    off, since failed prefs fell back to the defaults — and told the server
//    the phone had it covered, so the server's own push stayed quiet too.
//  - A repeating reminder left unticked for 8+ days used its 8-occurrence
//    allowance on days already gone, so it scheduled nothing, ever again.
//  - "✓ Took it" tapped with no network threw away the dose: no retry, no
//    word, and the resync after it cancelled everything (see the first point).

const ln = vi.hoisted(() => ({
  pending: [] as { id: number }[],
  scheduled: [] as any[],
  cancelled: [] as number[],
  listener: null as null | ((e: any) => Promise<void>),
}))

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    registerActionTypes: async () => {},
    getPending: async () => ({ notifications: ln.pending }),
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => {
      ln.cancelled.push(...notifications.map(n => n.id))
    },
    schedule: async ({ notifications }: { notifications: any[] }) => { ln.scheduled.push(...notifications) },
    addListener: async (_: string, fn: (e: any) => Promise<void>) => { ln.listener = fn; return { remove() {} } },
  },
}))
vi.mock("@/lib/native/bubble", () => ({ scheduleHeadPops: async () => 0 }))

import {
  resyncNotifications, syncNotifications, registerNotificationActionHandler, drainActionOutbox,
} from "@/lib/native/notifications"

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
}

/** YYYY-MM-DD on the machine's own clock, `offset` days from today. */
function localDay(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

type Route = (init?: RequestInit) => Response | Promise<Response>
let routes: Record<string, Route>
const calls: { url: string; init?: RequestInit }[] = []

function healthyRoutes(): Record<string, Route> {
  return {
    "/api/reminders": () => okJson([]),
    "/api/habits": () => okJson([{ id: "h1", name: "Stretch", reminderTime: "09:00", scheduleDays: [], timesPerWeek: null }]),
    "/api/med-schedule": () => okJson({ items: [{ id: "m1", name: "Atarax", times: ["22:00"], daysOfWeek: [], active: true, remind: true }] }),
    "/api/events": () => okJson([]),
    "/api/preferences/reminder-time": () => okJson({ hour: 8 }),
    "/api/preferences/noon-reminder": () => okJson({ enabled: false }),
    "/api/preferences/evening-reminder": () => okJson({ enabled: true }),
    "/api/morning-checkin": () => okJson({ checkin: null }),
    "/api/preferences/local-notifications": () => okJson({ ok: true }),
    "/api/medications": () => okJson({ ok: true }),
  }
}

beforeEach(() => {
  ln.pending = [{ id: 1_000_123 }, { id: 400_010 }]
  ln.scheduled = []
  ln.cancelled = []
  store.clear()
  calls.length = 0
  routes = healthyRoutes()
  vi.stubGlobal("window", { location: { pathname: "/dashboard", assign: () => {} } })
  vi.stubGlobal("localStorage", localStorageStub)
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const path = url.split("?")[0]
    const route = routes[path]
    if (!route) throw new Error(`unexpected fetch ${url}`)
    return route(init)
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const coveragePosted = () => calls.some(c => c.url === "/api/preferences/local-notifications")

describe("resyncNotifications refuses to rebuild from a failed load", () => {
  it("rebuilds and reports coverage when everything loads", async () => {
    const n = await resyncNotifications()
    expect(n).toBeGreaterThan(0)
    expect(ln.cancelled).toEqual([1_000_123, 400_010])
    expect(coveragePosted()).toBe(true)
  })

  it("leaves every pending alarm alone when a list fails to load (500)", async () => {
    routes["/api/med-schedule"] = () => new Response("boom", { status: 500 })
    const n = await resyncNotifications()
    expect(n).toBeNull()
    expect(ln.cancelled, "tonight's 22:00 dose was cancelled because one fetch failed").toEqual([])
    expect(ln.scheduled).toEqual([])
    expect(coveragePosted(), "the server was told the phone had it covered").toBe(false)
  })

  it("leaves every pending alarm alone when the session has expired (401)", async () => {
    routes["/api/habits"] = () => new Response("{}", { status: 401 })
    expect(await resyncNotifications()).toBeNull()
    expect(ln.cancelled).toEqual([])
    expect(coveragePosted()).toBe(false)
  })

  it("leaves every pending alarm alone when offline", async () => {
    for (const k of Object.keys(routes)) routes[k] = () => { throw new TypeError("Failed to fetch") }
    expect(await resyncNotifications()).toBeNull()
    expect(ln.cancelled).toEqual([])
    expect(ln.scheduled).toEqual([])
  })

  it("does not fall back to default nudges when a preference fails to load", async () => {
    // Default is noon on. The user switched it off; a failed read must not
    // switch it back on behind their back.
    routes["/api/preferences/noon-reminder"] = () => new Response("", { status: 502 })
    expect(await resyncNotifications()).toBeNull()
    expect(ln.scheduled.some(n => n.id === 910002)).toBe(false)
  })

  it("still rebuilds when only the optional check-in fails", async () => {
    routes["/api/morning-checkin"] = () => new Response("", { status: 500 })
    expect(await resyncNotifications()).toBeGreaterThan(0)
  })
})

describe("a repeating reminder left unticked keeps ringing", () => {
  it("counts a stale daily reminder's occurrences from today, not from its old due date", async () => {
    await syncNotifications([{
      id: "r1", title: "Stretch", dueDate: `${localDay(-10)}T00:00:00.000Z`, reminderTime: "09:00", repeat: "daily",
    }])
    const days = ln.scheduled
      .filter(n => n.extra?.kind === "reminder")
      .map(n => localDateOf(n.schedule.at))
    expect(days, "a daily reminder 10 days overdue scheduled nothing at all").toContain(localDay(1))
    expect(days).toContain(localDay(7))
  })

  it("keeps a stale weekly reminder on its weekday", async () => {
    await syncNotifications([{
      id: "r2", title: "Bins", dueDate: `${localDay(-70)}T00:00:00.000Z`, reminderTime: "09:00", repeat: "weekly",
    }])
    const days = ln.scheduled.filter(n => n.extra?.kind === "reminder").map(n => localDateOf(n.schedule.at))
    expect(days).toContain(localDay(7))
    expect(days.every(d => d === localDay(0) || d === localDay(7))).toBe(true)
  })
})

function localDateOf(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

describe("a notification action that could not be saved is kept, said, and retried", () => {
  const tapTookIt = async () => {
    await registerNotificationActionHandler()
    expect(ln.listener).not.toBeNull()
    await ln.listener!({
      actionId: "taken",
      notification: { id: 1_000_200, title: "💊 Time for your dose", extra: { kind: "med", name: "Atarax" } },
    })
  }

  it("queues the dose with the time it was taken when the POST cannot get through", async () => {
    routes["/api/medications"] = () => { throw new TypeError("Failed to fetch") }
    const before = Date.now()
    await tapTookIt()

    const outbox = JSON.parse(store.get("notif_action_outbox") ?? "[]")
    expect(outbox, "the dose was dropped on the floor").toHaveLength(1)
    const body = JSON.parse(outbox[0].body)
    expect(body.name).toBe("Atarax")
    expect(Date.parse(body.takenAt)).toBeGreaterThanOrEqual(before - 1000)

    // Said, not swallowed — and in the snooze range, so a resync can't eat it.
    const said = ln.scheduled.find(n => /couldn.t log/i.test(n.title))
    expect(said).toBeDefined()
    expect(said.id).toBeGreaterThanOrEqual(950_000)
    expect(said.id).toBeLessThan(960_000)

    // And the rebuild that follows a successful tap did not run on a failure.
    expect(ln.cancelled).toEqual([])
  })

  it("queues on a rejected session too", async () => {
    routes["/api/medications"] = () => new Response("{}", { status: 401 })
    await tapTookIt()
    expect(JSON.parse(store.get("notif_action_outbox") ?? "[]")).toHaveLength(1)
  })

  it("replays the queue once the network is back, then clears it", async () => {
    store.set("notif_action_outbox", JSON.stringify([{
      url: "/api/medications", method: "POST",
      body: JSON.stringify({ name: "Atarax", takenAt: new Date(Date.now() - 3_600_000).toISOString() }),
      label: "Atarax", at: Date.now() - 3_600_000,
    }]))
    await drainActionOutbox()
    const replay = calls.find(c => c.url === "/api/medications")
    expect(replay?.init?.method).toBe("POST")
    expect(JSON.parse(String(replay?.init?.body)).name).toBe("Atarax")
    expect(JSON.parse(store.get("notif_action_outbox") ?? "[]")).toEqual([])
  })

  it("keeps an entry the server still cannot take", async () => {
    routes["/api/medications"] = () => new Response("", { status: 503 })
    store.set("notif_action_outbox", JSON.stringify([{
      url: "/api/medications", method: "POST", body: "{\"name\":\"Atarax\"}", label: "Atarax", at: Date.now(),
    }]))
    await drainActionOutbox()
    expect(JSON.parse(store.get("notif_action_outbox") ?? "[]")).toHaveLength(1)
  })
})
