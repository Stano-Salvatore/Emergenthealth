import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"

// A standing guard, not a unit test.
//
// Bucketing a timestamp into a day by slicing its ISO string gives the UTC day.
// For anyone not on UTC, everything between local midnight and their offset
// lands on the day before. That mistake was found in fourteen places across
// this codebase in one sweep — in the correlation engine, in the experiments
// analysis, in what Emergy reports back, and twice in code that *writes* a
// journal entry or a check-in to the wrong date.
//
// Fixing fourteen instances does nothing about the fifteenth. This fails the
// build when a new one appears.
//
// It matches on field *names* that mean "an instant", so date-only columns —
// which Prisma returns at UTC midnight, making the slice exact — do not trip
// it. If a legitimate case ever needs to be added, it belongs in ALLOWED with
// the reason written down, not silenced.

const TIMESTAMP_FIELDS = [
  "loggedAt", "endedAt", "createdAt", "occurredAt", "startedAt",
  "takenAt", "trackedAt", "timestamp", "bedtimeStart",
].join("|")

const PATTERN = `\\.(${TIMESTAMP_FIELDS})\\.toISOString\\(\\)\\.(slice\\(0, ?10\\)|split\\("T"\\)\\[0\\])`

/** file:line entries that are correct despite matching. Each needs a reason. */
const ALLOWED: string[] = [
  // (none — every occurrence found in the sweep was a real bug and was fixed)
]

describe("no timestamp is bucketed into a day by UTC", () => {
  it("finds no new occurrences", () => {
    let out = ""
    try {
      out = execSync(
        `grep -rnE '${PATTERN}' src --include=*.ts --include=*.tsx || true`,
        { encoding: "utf8", cwd: process.cwd() },
      )
    } catch {
      // grep exits non-zero when nothing matches; the `|| true` covers it, and
      // a genuine failure to run must not silently pass the guard.
      out = ""
    }

    const hits = out
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .filter(l => !l.includes("__tests__"))
      .filter(l => !ALLOWED.some(a => l.startsWith(a)))

    expect(hits, [
      "A timestamp is being turned into a day by slicing its ISO string, which",
      "gives the UTC day rather than the user's.",
      "",
      "Use the user's timezone instead:",
      '  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: await getUserTimezone(userId) })',
      "  const day = dayFmt.format(row.loggedAt)",
      "",
      "If this really is correct, add it to ALLOWED in this file with the reason.",
    ].join("\n")).toEqual([])
  })
})

// ─── The same mistake, one step earlier: "today" ─────────────────────────────
//
// `new Date().toISOString().slice(0, 10)` is the server's UTC day, and for
// anyone ahead of Greenwich that is yesterday for the first hours of every
// morning. It was the default for "no date was sent" in eighteen places: a
// habit ticked at 00:30, a mood logged on the way to bed, a weight taken
// before dawn, the day Emergy thought it was — all filed one day early, and
// the streaks built on them broken for no visible reason.
//
// Server code has userToday(userId); client code has todayLocalISO(), which
// reads the device clock the user is actually looking at.

const TODAY_PATTERN = `new Date\\(\\)\\.toISOString\\(\\)\\.(slice\\(0, ?10\\)|split\\("T"\\)\\[0\\])`

/** file:line entries that are correct despite matching. Each needs a reason. */
const TODAY_ALLOWED: string[] = [
  // The fallback when no timezone was passed, documented as such at the call.
  "src/lib/toggl.ts",
]

describe("today is the user's day, not the server's", () => {
  it("finds no new occurrences", () => {
    let out = ""
    try {
      out = execSync(
        `grep -rnE '${TODAY_PATTERN}' src --include=*.ts --include=*.tsx || true`,
        { encoding: "utf8", cwd: process.cwd() },
      )
    } catch {
      out = ""
    }

    const hits = out
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .filter(l => !l.includes("__tests__"))
      // The line that documents the mistake is not the mistake.
      .filter(l => !/^\S+?:\d+:\s*(\/\/|\*)/.test(l))
      .filter(l => !TODAY_ALLOWED.some(a => l.startsWith(a)))

    expect(hits, [
      "Something is using the server's UTC day as \"today\".",
      "",
      "  server:  const day = await userToday(userId)   // @/lib/user-timezone",
      "  client:  const day = todayLocalISO()           // @/lib/local-date",
      "",
    ].join("\n")).toEqual([])
  })
})

// ─── And one step earlier still: "midnight" ─────────────────────────────────
//
// `const d = new Date(); d.setHours(0, 0, 0, 0)` reads as "start of today" and
// on Vercel is the start of the UTC day. Everything logged between local
// midnight and the user's offset — the first coffee, a habit ticked before
// bed at 00:10, the water the widget counts — fell off "today" and onto the
// day before. The same mistake wearing a different coat is
// `Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())` and
// `getUTCHours()` used as if it were the user's clock.
//
// Server code has userDay(userId) — the local date, the @db.Date value for it,
// and the instants the day starts and ends — so no route has to work any of
// this out again.

const MIDNIGHT_PATTERN = [
  `setHours\\(0, ?0, ?0, ?0\\)`,
  `Date\\.UTC\\([a-zA-Z_]+\\.getUTCFullYear\\(\\)`,
  `getUTCHours\\(\\)`,
].join("|")

/** file:line entries that are correct despite matching. Each needs a reason. */
const MIDNIGHT_ALLOWED: string[] = [
  // Six-month lower bound on a chart; the hours are irrelevant at that scale.
  "src/app/api/transactions/monthly/route.ts",
  // Seven-day lower bound on the email digest; likewise.
  "src/lib/digest.ts",
  // ISO-week label for a Strava activity — a few hours' drift at the Sunday
  // boundary moves a run between adjacent week rows, nothing more.
  "src/app/api/strava/activities/route.ts",
  // The no-timezone fallback branch, documented at the call.
  "src/lib/day-location.ts",
]

describe("midnight is the user's midnight, not the server's", () => {
  it("finds no new occurrences", () => {
    let out = ""
    try {
      out = execSync(
        `grep -rnE '${MIDNIGHT_PATTERN}' src --include=*.ts --include=*.tsx || true`,
        { encoding: "utf8", cwd: process.cwd() },
      )
    } catch {
      out = ""
    }

    const hits = out
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .filter(l => !l.includes("__tests__"))
      .filter(l => !/^\S+?:\d+:\s*(\/\/|\*)/.test(l))
      .filter(l => !MIDNIGHT_ALLOWED.some(a => l.startsWith(a)))

    expect(hits, [
      "Something is computing \"today\" from the server's clock.",
      "",
      "  const { today, dateColumn, start, end } = await userDay(userId)   // @/lib/user-timezone",
      "",
      "dateColumn for @db.Date columns (HabitCompletion.date, MoodLog.date…),",
      "start/end for timestamp columns (IntakeLog.loggedAt…).",
    ].join("\n")).toEqual([])
  })
})
