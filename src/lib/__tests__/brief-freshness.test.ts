import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The brief and the morning popup are the two places a person reads "last
// night" and "today" first thing. Each of these guards is a way they told
// the user something stale, or on the server's clock, as if it were now.

const stripped = (file: string): string =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const BRIEF = stripped("src/app/api/briefing/route.ts")
const TODAY = stripped("src/app/api/today/route.ts")
const BUBBLE = stripped("src/components/dashboard/DailyBriefing.tsx")

describe("/api/today reports last night only when it is last night", () => {
  // At 07:00, before any sync, the newest HealthLog row is yesterday's — the
  // night before last. The popup showed it as "How you slept 6.8 hrs ·
  // readiness 74", undated, under Emergy saying there was no sleep data yet.
  it("reads the newest row's date and compares it with the user's today", () => {
    const find = TODAY.slice(TODAY.indexOf("const latestHealth"), TODAY.indexOf("const sleep = {"))
    expect(find, "the sleep query no longer selects the row's date").toMatch(/select:\s*\{[^}]*\bdate:\s*true/)
    expect(find, "the row's date is never compared with today").toMatch(/latestHealth\.date\)\s*===\s*todayStr/)
    const sleep = TODAY.slice(TODAY.indexOf("const sleep = {"))
    const body = sleep.slice(0, sleep.indexOf("}"))
    expect(body, "the sleep card reads the newest row directly, whatever night it is").not.toMatch(/latestHealth\?*\./)
  })
})

describe("the brief is rewritten once the check-in lands", () => {
  // Generated at 07:02; the check-in at 07:10 said energy 2/5 and set an
  // intention, and the brief never mentioned it until noon — though reading
  // the check-in is half of what a morning brief is for.
  it("records whether it had a check-in, and looks for one before serving a brief that did not", () => {
    const store = BRIEF.slice(BRIEF.lastIndexOf("JSON.stringify("))
    expect(store).toMatch(/hadCheckin/)
    const check = BRIEF.slice(0, BRIEF.indexOf("staleButServable = "))
    expect(check).toMatch(/hadCheckin\s*===\s*false/)
    expect(check).toMatch(/"MorningCheckIn"/)
  })

  it("the bubble asks again when the app comes back to the foreground", () => {
    expect(BUBBLE).toMatch(/visibilitychange/)
  })
})

describe("a stale brief says it is stale", () => {
  // At 19:00 with the model unavailable, the morning's "the day is ahead…"
  // was served under a plain "Generated at 07:02", which reads as current.
  it("every stale serve is marked, and the bubble shows it", () => {
    const serves = BRIEF.match(/\.\.\.staleButServable[^}]*\}/g) ?? []
    expect(serves.length).toBeGreaterThanOrEqual(2)
    for (const s of serves) expect(s, `a stale brief is served unmarked: ${s}`).toMatch(/stale:\s*true/)
    expect(BUBBLE).toMatch(/\bstale\b/)
    expect(BUBBLE).toMatch(/from this /)
  })
})

describe("the brief's day is the user's day", () => {
  // In Prague, water logged at 00:40 was on the dashboard tile and missing
  // from "Water so far"; the walking line added yesterday's 70 minutes to
  // today's 60 beside "steps so far today"; the phone's night reached the
  // model as "21:10–04:40 UTC" and came back as "you slept from 21:10".
  it("timestamp columns are bounded by the user's midnight, not UTC's", () => {
    expect(BRIEF).toMatch(/zonedDayRange\(timezone, todayStr\)/)
    expect(BRIEF, "a timestamp range is still built from a UTC-midnight string")
      .not.toMatch(/(todayStart|todayEnd|dayStart|dayEnd)\s*=\s*new Date\(todayStr \+ "T/)
  })

  it("walking minutes are the same day the steps are, clipped to it", () => {
    const walk = BRIEF.slice(BRIEF.indexOf("activitySpan.findMany"))
    const where = walk.slice(0, walk.indexOf("})"))
    expect(where).not.toMatch(/86_400_000/)
    expect(where).toMatch(/end:\s*\{\s*gte:/)
    expect(BRIEF).toMatch(/const walkDay = period === "morning"/)
  })

  it("the phone's night is given in local time", () => {
    expect(BRIEF).not.toMatch(/UTC\)/)
    expect(BRIEF).toMatch(/localTimeStr\(timezone, night\.start\)/)
  })
})
