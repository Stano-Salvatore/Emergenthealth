import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The engine knows that a connected source speaks only for the days it
// existed — `calendarFrom` carries the rule in a comment. For a long time it
// was applied to one family, and eight other places read the same kind of
// silence as a zero: no workout, not busy, no screens.
//
// It is an easy thing to reintroduce, because `(d.workoutMin ?? 0) >= 20`
// looks complete. It compiles, it runs, it produces a card, and the card is
// wrong only in the days it counted. So this reads the source instead of the
// behaviour, the same way `no-utc-day-bucketing` does — the failure is an
// omission, and omissions have no runtime symptom to assert on.

const SRC = readFileSync("src/lib/correlations.ts", "utf8")

/** Fields whose absence means "not connected yet", not "none that day". */
const COERCIONS = ["workoutMin ?? 0", "screenTimeMin ?? 0", "eventCount ?? 0"]

/**
 * Assembly lines, where `?? 0` is an accumulator rather than a claim about
 * the day. Everything else has to be guarded.
 */
const ALLOWED = [
  "d.eventCount = (d.eventCount ?? 0) + 1",
  "d.workoutMin = (d.workoutMin ?? 0) + Math.round(a.movingTimeSec / 60)",
]

/**
 * How far above a coercion the guard is allowed to sit.
 *
 * Two real shapes put it there rather than inline: a loop that `continue`s
 * on uncovered days, and an `eligible` clause on the property above the
 * predicate. Both are one line up. Listing the guarded lines by their text
 * instead would go stale the moment someone deleted the guard and left the
 * line — the allowlist would then be excusing the bug it was written to
 * catch.
 */
const GUARD_WINDOW = 2

describe("no source is read as a zero before it was connected", () => {
  it("guards every coercion that could invent a control day", () => {
    const offenders: string[] = []
    const lines = SRC.split("\n")
    lines.forEach((line, i) => {
      if (!COERCIONS.some(c => line.includes(c))) return
      if (ALLOWED.some(a => line.includes(a))) return
      const near = lines.slice(Math.max(0, i - GUARD_WINDOW), i + 1).join("\n")
      if (/sourceCovers|calendarCovers/.test(near)) return
      offenders.push(`correlations.ts:${i + 1}  ${line.trim()}`)
    })
    expect(
      offenders,
      "these read a missing source as a zero. Wrap them in sourceCovers(...), or add the line to " +
      "ALLOWED with the reason it is already safe:\n" + offenders.join("\n"),
    ).toEqual([])
  })

  // The two loop-level guards are what several coercions lean on, and they
  // are a `continue` rather than anything the type system can hold onto.
  it("keeps the two loop-level guards the families lean on", () => {
    expect(SRC, "the calendar-load family lost its unknown-vs-quiet skip")
      .toContain("if (d.eventCount == null && !calendarCovers(d.date)) continue")
    expect(SRC, "the workout family lost its coverage skip")
      .toContain('if (!sourceCovers("workout", d.date)) continue')
  })
})
