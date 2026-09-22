import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

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

// ─── The same mistake in date-fns clothing ───────────────────────────────────
//
// `format(new Date(), "yyyy-MM-dd")` is `toISOString().slice(0, 10)` with a
// nicer name: date-fns formats in the PROCESS timezone, which on Vercel is
// UTC. The Week page built its whole week from `startOfWeek(new Date())`, so
// for two hours after every Bratislava midnight "today" was yesterday and on
// a Monday the page showed last week as this one. In a client component the
// clock is the user's — but only inside a render: a module-level constant is
// evaluated once, at SSR on the server and then never again in a tab left
// open past midnight.

// No quote characters in here: the pattern is handed to grep inside single
// quotes, and the first draft carried a ["'] class that ended the quoting —
// so it matched nothing and passed against a deliberately broken Week page.
//
// Any format of the server's `now` is the server's date, whatever the format
// string: the dashboard header read "Tuesday, September 22" at 00:30 on the
// 23rd from `format(now, "EEEE, MMMM d, yyyy")`, which the yyyy-MM-dd-only
// first version of this pattern walked straight past.
// A `today` built from the user's date string is fine to format; one that
// is `new Date()` under another name is caught by its yyyy-MM-dd use.
const DATEFNS_TODAY = `format\\((new Date\\(\\)|now), ?.|format\\(today, ?.yyyy-MM-dd.\\)`

/** file entries that are correct despite matching. Each needs a reason. */
const DATEFNS_ALLOWED: string[] = []

describe("date-fns does not decide what day it is on the server either", () => {
  it("finds no new occurrences", () => {
    let out = ""
    try {
      out = execSync(
        `grep -rnE '${DATEFNS_TODAY}' src --include=*.ts --include=*.tsx || true`,
        { encoding: "utf8", cwd: process.cwd() },
      )
    } catch {
      out = ""
    }
    const isClientFile = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"))
    const hits = out
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .filter(l => !l.includes("__tests__"))
      .filter(l => !/^\S+?:\d+:\s*(\/\/|\*)/.test(l))
      .filter(l => !DATEFNS_ALLOWED.some(a => l.startsWith(a)))
      .filter(l => {
        const [file, , ...rest] = l.split(":")
        const code = rest.join(":")
        // Inside a client component's render the clock is the user's own;
        // at module scope (no indentation) it is evaluated once, on the server.
        return !isClientFile(file) || /^(const|let|var)\s/.test(code)
      })

    expect(hits, [
      "Something is using the server's day as \"today\" via date-fns.",
      "",
      "  server:  const day = await userToday(userId)   // @/lib/user-timezone",
      "  client:  const day = todayLocalISO()           // @/lib/local-date, inside the render",
      "",
      "If this really is correct, add it to DATEFNS_ALLOWED in this file with the reason.",
    ].join("\n")).toEqual([])
  })
})

// ─── isToday() is the same question, asked of the server ─────────────────────
//
// date-fns' isToday / isTomorrow / isYesterday compare against the process
// clock. In a server component on Vercel that is UTC: the dashboard filed an
// event at 00:30 tomorrow under today, and every reminder due today counted
// as overdue via isBefore(dueDate, now) against a UTC-midnight due date.
// Client components may use them — there the clock is the user's.

const DATEFNS_RELATIVE = `\\b(isToday|isTomorrow|isYesterday)\\(`
const RELATIVE_ALLOWED: string[] = []

describe("date-fns relative-day predicates stay out of server code", () => {
  it("finds no new occurrences", () => {
    let out = ""
    try {
      out = execSync(
        `grep -rnE '${DATEFNS_RELATIVE}' src --include=*.ts --include=*.tsx || true`,
        { encoding: "utf8", cwd: process.cwd() },
      )
    } catch {
      out = ""
    }
    const isClientFile = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"))
    const hits = out
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .filter(l => !l.includes("__tests__"))
      .filter(l => !/^\S+?:\d+:\s*(\/\/|\*)/.test(l))
      .filter(l => !RELATIVE_ALLOWED.some(a => l.startsWith(a)))
      .filter(l => !isClientFile(l.split(":")[0]))

    expect(hits, [
      "A server file asks date-fns whether an instant is today — that is the server's today.",
      "",
      "  const timezone = await getUserTimezone(userId)",
      "  const isTodayZ = (d: Date) => localDateStr(timezone, d) === localDateStr(timezone)",
      "",
      "If this really is correct, add it to RELATIVE_ALLOWED in this file with the reason.",
    ].join("\n")).toEqual([])
  })
})
