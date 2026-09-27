import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The phone's alarms are a copy of what the server knows, rebuilt by
// resyncNotifications(). A screen that changes what should ring and does not
// ask for the rebuild leaves the copy stale until the next foreground at least
// half an hour later:
//
//  - a medication schedule added at 20:00 for 21:00 never rang, and the server
//    push stayed quiet because the phone said it had coverage;
//  - turning a schedule's reminder off, or deleting it, left up to 7 days of
//    alarms ringing;
//  - a dose logged early ("Take now", the log form) still let the later
//    "Time for your dose" fire — for a sedative, an invitation to a second one.
//
// And the foreground sync itself stamped its 30-minute throttle even when the
// rebuild had failed, so a phone opened without signal waited half an hour
// before trying again. Button taps that could not be saved are queued by
// notifications.ts, and are only replayed if something drains that queue.

const stripped = (file: string): string =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")

/** The source of `async function name(...) { ... }`, up to the next top-level-ish function. */
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`))
  if (start < 0) return ""
  const next = src.slice(start + 1).search(/\n\s*(async\s+)?function\s+\w+\s*\(/)
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next)
}

describe("the medication screens rebuild the phone's dose alarms", () => {
  const card = stripped("src/components/medications/MedScheduleCard.tsx")

  it("imports the rebuild at all", () => {
    expect(card).toMatch(/import\s*\{[^}]*\bresyncNotifications\b[^}]*\}\s*from\s*"@\/lib\/native\/notifications"/)
  })

  for (const fn of ["takeNow", "toggleRemind", "remove"]) {
    it(`MedScheduleCard.${fn} asks for a rebuild`, () => {
      const body = fnBody(card, fn)
      expect(body, `no function ${fn} found in MedScheduleCard`).not.toBe("")
      expect(body, `${fn} changes what should ring but never calls resyncNotifications()`).toMatch(/resyncNotifications\(\)/)
    })
  }

  it("a new schedule asks for a rebuild once it is saved", () => {
    expect(card).toMatch(/<ScheduleForm[^>]*onDone=\{[^}]*resyncNotifications\(\)/)
  })

  it("the medications page asks for a rebuild after logging or changing a dose", () => {
    const page = stripped("src/app/dashboard/medications/page.tsx")
    expect(fnBody(page, "logDose")).toMatch(/resyncNotifications\(\)/)
    // Entry edits and deletes go through onChanged — every one of them must
    // land on a handler that rebuilds.
    const handlers = [...page.matchAll(/onChanged=\{(\w+)\}/g)].map(m => m[1]).filter(h => h !== "onChanged")
    expect(handlers.length).toBeGreaterThan(0)
    for (const h of handlers) {
      const def = new RegExp(`const\\s+${h}\\s*=[^\\n]*\\n?[^\\n]*resyncNotifications\\(\\)`)
      expect(page, `onChanged={${h}} does not rebuild the phone's alarms`).toMatch(def)
    }
  })
})

describe("the foreground sync", () => {
  const bridge = stripped("src/components/NativeBridge.tsx")

  it("stamps its throttle only after a rebuild that went through", () => {
    const setAt = bridge.indexOf("localStorage.setItem(LS_KEY")
    expect(setAt).toBeGreaterThan(-1)
    const line = bridge.slice(bridge.lastIndexOf("\n", setAt), setAt)
    expect(line, "the throttle is stamped whether or not resyncNotifications() succeeded").toMatch(/if\s*\(\s*\w+\s*!==\s*null\s*\)/)
  })

  it("replays queued notification taps on open, on foreground and when the network returns", () => {
    const calls = bridge.match(/drainActionOutbox\(\)/g) ?? []
    expect(calls.length, "drainActionOutbox() is not called on both mount and foreground").toBeGreaterThanOrEqual(2)
    expect(bridge).toMatch(/addEventListener\("online"/)
  })
})
