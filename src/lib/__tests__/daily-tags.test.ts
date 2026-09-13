import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  dailyTagsKey, mergeTags, normaliseTag, normaliseTags, resolveTagDate,
  MAX_TAGS_PER_DAY, MAX_TAG_LENGTH, MAX_BACKDATE_DAYS,
} from "@/lib/daily-tags"

// Tags are the one thing in this app the user writes in their own words, and
// the correlation engine's onset family reads them by exact string: a tag that
// was silent for a fortnight and then started appearing, compared against the
// matched stretch before it. That comparison needs six occurrences to run.
//
// Which makes two things load-bearing. One rule for shaping a tag, or "Travel"
// and "travel" become two tags with half the days each and neither clears the
// bar. And a date, because the question this answers — "what changed in late
// August?" — is about days that are not today, and a month of context recorded
// as one tag on today is a month the engine cannot see.

describe("one tag, one shape", () => {
  it("folds case and trims, so both writers agree", () => {
    expect(normaliseTag("  Travel ")).toBe("travel")
    expect(normaliseTag("NEW JOB")).toBe("new job")
  })

  it("refuses what isn't a tag", () => {
    // An empty string would become a tag every day shares, which is a tag that
    // correlates with everything and means nothing.
    expect(normaliseTag("   ")).toBeNull()
    expect(normaliseTag("")).toBeNull()
    expect(normaliseTag(null)).toBeNull()
    expect(normaliseTag(7)).toBeNull()
  })

  it("keeps a tag a label rather than a paragraph", () => {
    expect(normaliseTag("x".repeat(80))).toHaveLength(MAX_TAG_LENGTH)
  })
})

describe("a day's worth", () => {
  it("drops duplicates that differ only in shape", () => {
    expect(normaliseTags(["Travel", "travel", " TRAVEL "])).toEqual(["travel"])
  })

  it("caps the day", () => {
    const many = Array.from({ length: 25 }, (_, i) => `tag${i}`)
    expect(normaliseTags(many)).toHaveLength(MAX_TAGS_PER_DAY)
  })

  it("survives a value that isn't a list at all", () => {
    // This is read back out of a JSON blob written months ago; a corrupt one
    // must not take the Check-in page down with it.
    expect(normaliseTags(null)).toEqual([])
    expect(normaliseTags("travel")).toEqual([])
    expect(normaliseTags([null, 3, "", "flu"])).toEqual(["flu"])
  })
})

describe("adding to a day that already has tags", () => {
  it("keeps what was already there", () => {
    // The failure this prevents: the Check-in page owns the whole array and
    // sends it whole. A second writer doing the same deletes the first's work.
    const out = mergeTags(["travel", "late night"], ["flu"])
    expect(out.tags).toEqual(["travel", "late night", "flu"])
    expect(out.added).toEqual(["flu"])
  })

  it("says which were already there rather than adding them twice", () => {
    const out = mergeTags(["flu"], ["Flu", "travel"])
    expect(out.tags).toEqual(["flu", "travel"])
    expect(out.added).toEqual(["travel"])
    expect(out.alreadyThere).toEqual(["flu"])
  })

  it("reports what would not fit instead of dropping it quietly", () => {
    // A tag the user believes they logged and the engine never sees is exactly
    // the silence this whole path exists to end.
    const full = Array.from({ length: MAX_TAGS_PER_DAY }, (_, i) => `tag${i}`)
    const out = mergeTags(full, ["flu"])
    expect(out.added).toEqual([])
    expect(out.noRoom).toEqual(["flu"])
    expect(out.tags).toHaveLength(MAX_TAGS_PER_DAY)
  })

  it("takes a bare string as well as a list", () => {
    expect(mergeTags([], "flu").added).toEqual(["flu"])
  })

  it("adds nothing when there is nothing to add", () => {
    const out = mergeTags(["travel"], ["  ", null])
    expect(out.tags).toEqual(["travel"])
    expect(out.added).toEqual([])
  })
})

describe("which day", () => {
  const today = "2026-09-13"

  it("defaults to today", () => {
    expect(resolveTagDate(undefined, today)).toEqual({ day: today })
    expect(resolveTagDate("", today)).toEqual({ day: today })
  })

  it("takes a past day, which is the entire point", () => {
    expect(resolveTagDate("2026-08-28", today)).toEqual({ day: "2026-08-28" })
  })

  it("refuses a day that hasn't happened", () => {
    const out = resolveTagDate("2026-09-14", today)
    expect(out).toHaveProperty("error")
    expect("error" in out && out.error).toContain("hasn't happened")
  })

  it("refuses further back than anything reads", () => {
    // The engine's longest window is a year. A tag older than that is written
    // somewhere nothing will ever look, which is worse than refusing it.
    expect(resolveTagDate("2024-01-01", today)).toHaveProperty("error")
    expect(MAX_BACKDATE_DAYS).toBe(365)
  })

  it("refuses something that isn't a date", () => {
    for (const bad of ["last tuesday", "28-08-2026", "2026-8-28", 20260828]) {
      expect(resolveTagDate(bad, today), String(bad)).toHaveProperty("error")
    }
  })
})

describe("both writers use the one rule", () => {
  // The guard that matters. The Check-in route had this logic inline; Emergy
  // is the second writer, and a copy in either place drifts the moment someone
  // changes a cap. The onset family would go on reading both and see two tags.
  const route = readFileSync("src/app/api/daily-tags/route.ts", "utf8")
  const chat = readFileSync("src/lib/claude.ts", "utf8")

  it("the Check-in route shapes tags through the shared helper", () => {
    expect(route).toContain("normaliseTags(")
    expect(route, "an inline copy of the rule will drift from the one Emergy uses")
      .not.toMatch(/toLowerCase\(\)\s*\.slice/)
  })

  it("both build the key the same way", () => {
    expect(route).toContain("dailyTagsKey(")
    expect(chat).toContain("dailyTagsKey(")
    expect(dailyTagsKey("2026-08-28")).toBe("daily_tags:2026-08-28")
  })

  it("Emergy merges rather than replacing", () => {
    // A plain upsert of the incoming tags here would wipe the day's existing
    // ones, and the user would find out weeks later when a card never fired.
    const handler = chat.slice(chat.indexOf('if (name === "log_tag")'))
    const body = handler.slice(0, handler.indexOf('if (name === "write_daily_note")'))
    expect(body).toContain("mergeTags(")
    expect(body, "the handler must read the day before writing it").toContain("SELECT \"value\"")
  })

  it("Emergy's tool takes a date", () => {
    // Without it the answer to "what changed in August" lands on today, and
    // the onset family — which is looking for when something started — sees a
    // single day instead of the month it describes.
    const spec = chat.slice(chat.indexOf('name: "log_tag"'))
    expect(spec.slice(0, spec.indexOf("write_daily_note"))).toContain("date:")
    expect(chat).toContain("resolveTagDate(input.date")
  })

  it("the engine reads the key these write", () => {
    // The whole point of writing them. If correlations.ts stops reading this
    // prefix, every tag logged here becomes write-only.
    expect(readFileSync("src/lib/correlations.ts", "utf8")).toContain("daily_tags:")
  })
})
