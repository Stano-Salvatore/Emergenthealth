import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The database is Neon on the free plan: it sleeps after five quiet minutes
// and the month's compute allowance is counted in minutes awake. Anything
// that reaches the server on a timer shorter than that keeps it awake for
// good, and on 21 October 2026 that ran the allowance out with ten days of
// the month left — every screen, sign-in included, down until the 1st.
//
// Two native timers did it between them: the location service uploading a
// point every five minutes, and three widgets refreshing every half hour on
// three separate clocks. Both are batched now. Shortening either looks like
// a harmless tweak in a diff, which is why this is a test.

const read = (f: string) => readFileSync(`android-widget/${f}`, "utf8")

/** `30 * 60_000` and the like, as milliseconds. */
function millis(src: string, name: string): number {
  const m = src.match(new RegExp(`${name}\\s*=\\s*([\\d_\\s*L]+);`))
  if (!m) throw new Error(`${name} not found`)
  return m[1].replace(/[_L\s]/g, "").split("*").reduce((a, n) => a * Number(n), 1)
}

describe("the database gets to sleep", () => {
  const location = read("EmergyLocationService.java")

  it("location goes up at most every half hour", () => {
    expect(millis(location, "UPLOAD_EVERY_MS")).toBeGreaterThanOrEqual(30 * 60_000)
  })

  it("both upload paths wait for the batch", () => {
    // onFix arms the flush; the watchdog's flushPending retries it. Either one
    // uploading on its own clock would undo the batching.
    const onFix = location.slice(location.indexOf("private void onFix("), location.indexOf("private static String iso("))
    const gate = onFix.indexOf("if (!uploadDue(this)) return;")
    expect(gate).toBeGreaterThan(-1)
    expect(onFix.indexOf("main.postDelayed(flushNow")).toBeGreaterThan(gate)
    const pending = location.slice(location.indexOf("static void flushPending("), location.indexOf("ctx.startService("))
    expect(pending).toContain("if (!uploadDue(ctx)) return;")
  })

  it("the widgets that read the server share one hourly refresh", () => {
    expect(millis(read("TodayWidget.java"), "PERIODIC_GAP_MS")).toBeGreaterThanOrEqual(55 * 60_000)
    for (const [file, name] of [["TodayWidget.java", "today"], ["HabitsWidget.java", "habits"], ["RemindersWidget.java", "reminders"]]) {
      const onUpdate = read(file).match(/public void onUpdate\([^)]*\)\s*\{([^}]*)\}/)
      expect(onUpdate?.[1].trim(), file).toMatch(new RegExp(`^(TodayWidget\\.)?periodicRefresh\\(context, "${name}", ids\\);$`))
    }
  })
})
