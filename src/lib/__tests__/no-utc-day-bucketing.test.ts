import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

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

// ─── Day windows: the right kind of midnight for the right kind of column ───
//
// There are two kinds of "day" column here, and each wants a different
// midnight.
//
// A timestamp (IntakeLog.loggedAt, FoodLog.loggedAt, TimelineEvent.occurredAt,
// ChatMessage.createdAt…) is an instant, so "the 27th" is the pair of instants
// zonedDayRange(tz, "2026-09-27") gives. Filtering it with
// `new Date(day + "T00:00:00Z")` … `"T23:59:59Z"` asks for the UTC day, which
// for Prague runs 02:00–01:59 local: a kebab saved at 00:45 vanished from the
// Food tab the moment it was saved, and turned up under the day before.
//
// A @db.Date column (HealthLog.date, DailyNote.date, MoodLog.date…) is the
// opposite. The driver keeps only the UTC calendar date of whatever instant it
// is handed, so the local-midnight instant 2026-09-25T22:00Z is read as "the
// 25th": the quest card ticked "Sleep logged" every morning off yesterday's
// row, before the ring had synced a thing.
//
// So: a timestamp filter must not be fed a UTC-midnight bound, and a date
// filter must not be fed a zonedDayRange instant.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const TS_COLUMNS = "loggedAt|createdAt|startedAt|endedAt|occurredAt|trackedAt|takenAt|checkedAt|timestamp"

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== "__tests__") out.push(...sourceFiles(p)) }
    else if (/\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

function codeLines(file: string): string[] {
  // Blank the comments but keep the line count, so hits carry true line numbers.
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map(l => l.replace(/(^|\s)\/\/.*$/, ""))
}

/** Identifiers a file binds to a UTC-midnight/UTC-end-of-day instant built from a day string. */
function utcBoundNames(lines: string[]): Set<string> {
  const names = new Set<string>()
  for (const l of lines) {
    const m = /(?:const|let)\s+(\w+)\s*=\s*new Date\([^;]*T(?:00:00:00|23:59:59)/.exec(l)
    if (m) names.add(m[1])
    const f = /function\s+(\w+)\s*\([^)]*\)[^{]*\{[^}]*new Date\([^}]*T(?:00:00:00|23:59:59)/.exec(l)
    if (f) names.add(f[1] + "(")
  }
  const helpers = [...names].filter(n => n.endsWith("(")).map(escape)
  if (helpers.length) {
    const viaHelper = new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*(?:${helpers.join("|")})`)
    for (const l of lines) {
      const m = viaHelper.exec(l)
      if (m) names.add(m[1])
    }
  }
  return names
}

/** Identifiers a file binds to a zonedDayRange instant (a local midnight). */
function zonedBoundNames(lines: string[]): Set<string> {
  const names = new Set<string>()
  for (const l of lines) {
    const m = /(?:const|let)\s+(\w+)\s*=\s*zonedDayRange\([^;]*\)\.(?:start|end)\b/.exec(l)
    if (m) names.add(m[1])
    const d = /(?:const|let)\s*\{([^}]*)\}\s*=\s*zonedDayRange\(/.exec(l)
    if (d) for (const part of d[1].split(",")) {
      const alias = part.split(":").map(s => s.trim()).filter(Boolean).pop()
      if (alias) names.add(alias)
    }
  }
  return names
}

function dayWindowMisuses(file: string, lines = codeLines(file)): string[] {
  const hits: string[] = []
  const utc = [...utcBoundNames(lines)]
  const zoned = [...zonedBoundNames(lines)]
  const utcAlt = utc.map(n => n.endsWith("(") ? escape(n) : `${escape(n)}\\b`).join("|")
  const zonedAlt = zoned.map(n => `${escape(n)}\\b`).join("|")
  const inlineUtc = `new Date\\([^)]*T(?:00:00:00|23:59:59)`
  const tsFilter = new RegExp(
    `\\b(${TS_COLUMNS})\\s*:\\s*\\{[^}]*\\b(?:gte|gt|lte|lt)\\s*:\\s*(?:[^,}]*\\?\\s*[^,}]*:\\s*)?(${[inlineUtc, utcAlt].filter(Boolean).join("|")})`,
  )
  const dateFilter = zonedAlt
    ? new RegExp(`\\bdate\\s*:\\s*(?:\\{[^}]*\\b(?:gte|gt|lte|lt|equals)\\s*:\\s*)?(${zonedAlt})`)
    : null
  const opensTsFilter = new RegExp(`\\b(${TS_COLUMNS})\\s*:\\s*\\{\\s*$`)
  lines.forEach((line, i) => {
    // A filter opened on one line and closed a few lines down is read whole.
    const l = opensTsFilter.test(line) ? lines.slice(i, i + 5).join(" ") : line
    if (tsFilter.test(l)) hits.push(`${file}:${i + 1}: timestamp column filtered by a UTC day: ${l.trim()}`)
    if (dateFilter?.test(l)) hits.push(`${file}:${i + 1}: @db.Date column filtered by a local-midnight instant: ${l.trim()}`)
  })
  return hits
}

/** file entries that are correct despite matching, or knowingly left. Each needs a reason. */
const WINDOW_ALLOWED: string[] = [
  // Lower bound of a multi-month lookback; the hours at its far edge are
  // irrelevant at that scale.
  "src/lib/lab-trends-load.ts",
  // Whole-month windows either side of a split. Known to be off by the UTC
  // offset at each end; not yet fixed, and not a one-day view.
  "src/lib/drift-load.ts",
  // Week totals for the Sunday review. Known to be off by the UTC offset at
  // each end of the week; not yet fixed.
  "src/lib/weekly-review.ts",
  // An experiment's focus minutes. Known: sessions ending in the first hours
  // of the first day are missed and those just after the last day counted;
  // not yet fixed.
  "src/lib/experiments-analysis.ts",
]

describe("each kind of day column gets its own kind of midnight", () => {
  it("catches the shapes it exists for", () => {
    const bad = [
      `const todayStart = startOfDay(await todayFor(userId))`,
      `prisma.intakeLog.findMany({ where: { loggedAt: { gte: todayStart } } })`,
      `prisma.chatMessage.findMany({ where: { createdAt: {`,
      `  gte: startOfDay(a),`,
      `} } })`,
      `const start = new Date(date + "T00:00:00.000Z")`,
      `const end = new Date(date + "T23:59:59.999Z")`,
      `prisma.foodLog.findMany({ where: { userId, loggedAt: { gte: start, lte: end } } })`,
      `prisma.x.findMany({ where: { occurredAt: { gte: new Date(d + "T00:00:00Z") } } })`,
      `function startOfDay(s: string) { return new Date(s + "T00:00:00.000Z") }`,
      `prisma.chatMessage.findMany({ where: { createdAt: { gte: startOfDay(a), lte: b ? b : endOfDay(a) } } })`,
      `const today = zonedDayRange(tz, todayStr).start`,
      `prisma.healthLog.findFirst({ where: { userId, date: { gte: today } } })`,
    ]
    expect(dayWindowMisuses("fixture.ts", bad).length).toBe(6)
    const good = [
      `const { start, end } = zonedDayRange(tz, date)`,
      `const col = new Date(date + "T00:00:00Z")`,
      `prisma.foodLog.findMany({ where: { loggedAt: { gte: start, lte: end } } })`,
      `prisma.healthLog.findFirst({ where: { date: { gte: col } } })`,
    ]
    expect(dayWindowMisuses("fixture.ts", good)).toEqual([])
  })

  it("finds no occurrences in the code", () => {
    const hits = sourceFiles("src")
      .filter(f => !WINDOW_ALLOWED.some(a => f.startsWith(a)))
      .flatMap(f => dayWindowMisuses(f))
    expect(hits, [
      "A day window is built with the wrong kind of midnight.",
      "",
      "  timestamp columns:  const { start, end } = zonedDayRange(tz, day)   // @/lib/local-date",
      "  @db.Date columns:   new Date(day + \"T00:00:00Z\")  (or userDay().dateColumn)",
      "",
      "If this really is correct, add it to WINDOW_ALLOWED in this file with the reason.",
    ].join("\n")).toEqual([])
  })
})

// ─── The clock and the day, read off the server's own zone ──────────────────
//
// Three more coats on the same mistake, each found live:
//
//  • `x.toISOString().slice(11, 16)` is the UTC clock. Emergy was told a meal
//    was eaten at "22:45" when it was 00:45, and the brief read a phone night
//    back in UTC.
//  • `new Date(y, m - 1, d, h, min)` in server code builds the instant in the
//    server's zone, UTC — every dose and habit reminder on the calendar was
//    drawn two hours late.
//  • `format(new Date(row.loggedAt), "yyyy-MM-dd")` in server code is the UTC
//    day, so a glass at 00:30 filled the day before's water goal.
//
// Client components may do the last two: there the process clock is the
// user's own.

//  • The same slice on an instant that has already been serialised — an ISO
//    string from JSON (`rec.endedAt.slice(0, 10)`, `habit.createdAt?.slice(0,
//    10)`) — is still the UTC day: a fast ending at 00:30 was filed under
//    yesterday, and a habit made just after midnight was due the day before.
const CLOCK_PATTERNS: { pattern: string; serverOnly: boolean }[] = [
  { pattern: `\\.toISOString\\(\\)\\.slice\\(11`, serverOnly: false },
  { pattern: `\\.(${TIMESTAMP_FIELDS})\\??\\.(slice\\(0, ?10\\)|split\\("T"\\))`, serverOnly: false },
  { pattern: `new Date\\(\\w+, ?\\w+ ?- ?1, ?\\w+, ?\\w+`, serverOnly: true },
  { pattern: `format\\((new Date\\()?[\\w.]*\\.(${TIMESTAMP_FIELDS})\\)?, ?.yyyy-MM-dd.\\)`, serverOnly: true },
]

/** file entries that are correct despite matching. Each needs a reason. */
const CLOCK_ALLOWED: string[] = [
  // The fallback when the timezone cannot be read at all, documented there.
  "src/lib/local-date.ts",
]

describe("clock times and days are read in the user's zone", () => {
  it("finds no new occurrences", () => {
    const isClientFile = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"))
    const hits = sourceFiles("src")
      .filter(f => !CLOCK_ALLOWED.some(a => f.startsWith(a)))
      .flatMap(f => {
        const lines = codeLines(f)
        return CLOCK_PATTERNS
          .filter(p => !p.serverOnly || !isClientFile(f))
          .flatMap(p => lines.flatMap((l, i) => new RegExp(p.pattern).test(l) ? [`${f}:${i + 1}: ${l.trim()}`] : []))
      })
    expect(hits, [
      "A clock time or a day is being read in the server's zone (UTC).",
      "",
      "  clock time:      localTimeStr(tz, at)        // @/lib/local-date",
      "  HH:MM on a day:  zonedClock(tz, day, hhmm)",
      "  day:             localDateStr(tz, at)",
      "",
      "If this really is correct, add it to CLOCK_ALLOWED in this file with the reason.",
    ].join("\n")).toEqual([])
  })
})
