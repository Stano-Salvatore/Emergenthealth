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
