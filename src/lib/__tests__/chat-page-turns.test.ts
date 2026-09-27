import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const page = strip("src/app/dashboard/chat/page.tsx")

// The phone's alarms are scheduled on the phone. After a chat turn that
// changes what should ring, the page re-lays them — but it only did so for
// four tools. "Skip the run today, knee hurts" left the 18:00 run alarm
// ringing; "yes, did it" to the intention question still got the evening
// "how did it go?"; "dentist 15:00, alert 30 min before" got no alarm at all;
// and a logged (or deleted, or corrected) dose left the med alarm counting
// the wrong number of doses taken.
describe("chat turns that change the phone's alarms resync them", () => {
  const literal = page.match(/const REMINDER_TOOLS = \/(.+)\/\s*\n/)
  const REMINDER_TOOLS = new RegExp(literal?.[1] ?? "(?!)")

  it.each([
    "create_reminder", "complete_reminder", "create_med_schedule", "create_habit",
    "skip_habit_today", "complete_habit_today", "create_event",
    "log_morning_checkin", "close_intention", "log_dose", "delete_log", "correct_log",
  ])("%s", (tool) => {
    expect(REMINDER_TOOLS.test(tool)).toBe(true)
  })

  it("does not resync for a tool that cannot touch an alarm", () => {
    expect(REMINDER_TOOLS.test("log_water")).toBe(false)
    expect(REMINDER_TOOLS.test("get_health_range")).toBe(false)
  })

  it("ticking a habit off on the Habits page also stops today's alarm", () => {
    // Skip resynced; complete (and un-complete) did not, so a habit done at
    // 09:00 still rang at 18:00.
    const habits = strip("src/app/dashboard/habits/page.tsx")
    const at = habits.indexOf("async function toggleComplete")
    const body = habits.slice(at, habits.indexOf("\n  }\n", at))
    expect(body).toMatch(/resyncNotifications\(\)/)
  })

  it("names only tools Emergy actually has", () => {
    const claude = readFileSync("src/lib/claude.ts", "utf8")
    const names = (literal?.[1] ?? "").replace(/^\^\(|\)\$$/g, "").split("|")
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(claude).toContain(`name: "${name}"`)
  })
})

// "log the goulash, 650 kcal", lock the phone. The server finishes the turn
// (it runs past the response), but the screen's stream dies — and the bubble
// said "Sorry, something went wrong. Please try again." with a Retry button.
// Retry ran log_food a second time: two goulash rows, 1300 kcal. A dropped
// stream is not a failed turn; the screen has to say the turn is still
// finishing, keep Retry away while it is, and go and find the reply.
describe("a dropped stream is not reported as a failed turn", () => {
  const catchBlock = page.slice(page.indexOf("} catch (err) {"), page.indexOf("} finally {", page.indexOf("} catch (err) {")))

  it("the generic 'try again' note is gone", () => {
    expect(page).not.toMatch(/Sorry, something went wrong\. Please try again\./)
  })
  it("the bubble is marked pending and the catch-up starts straight away", () => {
    expect(catchBlock).toMatch(/pending: true/)
    expect(catchBlock).toMatch(/catchUp\(\)/)
  })
  it("a rejection after the catch-up already swapped the reply in leaves it alone", () => {
    expect(catchBlock).toMatch(/pendingTurn\.current\?\.seq !== myTurn\) return/)
  })
  it("no Retry on a reply that is still finishing", () => {
    expect(page).toMatch(/onRetry=\{[^}]*!msg\.pending/)
  })
  it("a new chat's turn can still be found when the stream died before naming its thread", () => {
    expect(page).toMatch(/freshConversation\(/)
  })
  it("polls long enough to outlast the longest turn the server allows", () => {
    const route = strip("src/app/api/chat/route.ts")
    const maxDuration = Number(route.match(/export const maxDuration = (\d+)/)?.[1])
    const attempts = Number(page.match(/const CATCH_UP_ATTEMPTS = (\d+)/)?.[1])
    const everyMs = Number(page.match(/const CATCH_UP_EVERY_MS = ([\d_]+)/)?.[1]?.replace(/_/g, ""))
    expect(attempts * everyMs).toBeGreaterThanOrEqual(maxDuration * 1000)
  })
  it("giving up tells the user to check before resending", () => {
    expect(page).toMatch(/check your log before resending/)
  })
})

// Turn 1 is pocketed and its catch-up poll is running. The user sends M2.
// Turn 1 finishes, the transcript's last row is an assistant, and the old
// poll swapped the screen for the transcript — dropping M2's streaming
// bubble — and re-enabled Send. M2's words then streamed onto the end of
// A1's bubble: two answers in one. Every update now targets its own turn's
// bubble, and a poll for an older turn never touches the screen.
describe("a stale catch-up never overwrites a newer turn", () => {
  const send = page.slice(page.indexOf("async function sendMessage"), page.indexOf("function handleKeyDown"))

  it("stream updates target their own bubble, not whichever is last", () => {
    expect(send).not.toMatch(/i === m\.length - 1/)
    expect(send).toMatch(/localId/)
  })
  it("the poll is tied to the turn it was started for", () => {
    const poll = page.slice(page.indexOf("const catchUp = useCallback"), page.indexOf("const catchUp = useCallback") + 2500)
    expect(poll).toMatch(/turnSeq\.current !== turn\.seq/)
    expect(poll).toMatch(/replyLanded\(/)
  })
  it("only the newest turn may re-enable the composer", () => {
    expect(send).toMatch(/turnSeq\.current === myTurn/)
  })
})
