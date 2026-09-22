import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// Mood was asked three times on one screen: the top of Home, the bottom of
// Home, and step 2 of the check-in. Same five faces, same day, one number —
// and the two on Home wrote a DIFFERENT TABLE from the one the check-in
// writes.
//
// That second half is what makes this worth a guard. Taking the buttons off
// Home is a two-line edit; the four readers that took mood from `MoodLog`
// alone would then have gone quiet — the monthly drift comparison, the Sunday
// review, and both of Emergy's context loads — with no error and no empty
// state, just a metric that stops appearing some weeks later.

const src = (f: string) => readFileSync(f, "utf8")
/** Comments may name the table they keep a reader away from; code may not. */
const code = (f: string) =>
  src(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

/** Every .ts/.tsx under `dir`, tests excluded. */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(join(dir, e.name))
    return /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
  })

/** Files allowed to touch MoodLog on its own: the export, and the merge itself. */
const MOOD_LOG_OWN = [
  "src/lib/mood-series.ts",
  "src/app/api/export/route.ts",
]

describe("one surface asks it", () => {
  it("the check-in still does", () => {
    const checkin = src("src/app/dashboard/checkin/page.tsx")
    expect(checkin).toContain("How&apos;s your mood?")
    expect(checkin).toContain("/api/morning-checkin")
  })

  it("Home does not, in either of the two places it used to", () => {
    const home = code("src/app/dashboard/page.tsx")
    const quickLog = code("src/components/dashboard/QuickLog.tsx")
    expect(home, "the greeting card asked it once").not.toMatch(/MoodWidget|How do you feel/i)
    expect(quickLog, "and QuickLog asked it again four screens below")
      .not.toMatch(/logMood|MOOD_EMOJIS/)
  })

  it("and no longer posts to the standalone endpoint", () => {
    // Emergy's log_mood tool is the remaining writer, which is the point:
    // one deliberate surface, plus asking him.
    for (const f of ["src/app/dashboard/page.tsx", "src/components/dashboard/QuickLog.tsx"]) {
      expect(code(f), `${f} still writes MoodLog`).not.toContain('"/api/mood"')
    }
    expect(src("src/lib/claude.ts"), "Emergy must still be able to log a mood")
      .toContain("moodLog.upsert")
  })
})

describe("every reader sees both tables", () => {
  // The rule lives in lib/mood-series and nowhere else. A reader that queries
  // moodLog directly has quietly opted out of check-in moods.
  const READERS = [
    "src/lib/drift-load.ts",
    "src/lib/weekly-review.ts",
    "src/lib/claude.ts",
  ]

  it("reads mood through the shared merge", () => {
    for (const f of READERS) {
      expect(code(f), `${f} should load mood via lib/mood-series`)
        .toMatch(/loadMoodByDay\(|loadMoodSeries\(/)
    }
  })

  it("nobody anywhere reads one mood table on its own", () => {
    // The real invariant, and the one the buttons coming off Home would have
    // broken: a file may reach MoodLog directly — several predate the helper
    // and read those rows for other columns too — but never WITHOUT also
    // reaching the check-in's. That combination is the silent failure.
    //
    // Found by WALKING src, not from a list. The first version of this test
    // named five readers by hand, and six more read MoodLog alone the whole
    // time it passed: the Health chart's mood line, the month glyphs, both
    // place-mood comparisons, the "mood today vs your average" row and the
    // daily quests' "Log your mood" — which sat under a check-in quest that
    // had just said "Energy & mood logged".
    const readsMoodLog = /moodLog\.(findMany|findFirst|findUnique|count|aggregate|groupBy)/
    const readers = walk("src").filter(f => readsMoodLog.test(code(f)))
    expect(readers.length, "no MoodLog reader found at all — the regex is reading nothing").toBeGreaterThan(5)
    for (const f of readers) {
      if (MOOD_LOG_OWN.some(o => f.endsWith(o))) continue
      // The parenthesis matters: an unused `import { loadMoodSeries }` left
      // behind by a revert satisfies the bare name and proves nothing. The
      // first draft of this test did exactly that and passed against a reader
      // I had deliberately broken.
      expect(code(f), `${f} reads MoodLog and never MorningCheckIn — every check-in mood is invisible to it`)
        .toMatch(/MorningCheckIn|loadMoodByDay\(|loadMoodSeries\(/)
    }
  })

  it("and the check-in wins wherever both are in hand", () => {
    // One rule, four spellings of it. The deliberate answer beats the casual
    // tap; claude.ts had this backwards on its own until the buttons went.
    expect(code("src/lib/mood-series.ts"), "the helper documents the order by applying it")
      .toContain("if (c.mood != null) byDay.set(")
    for (const f of ["src/lib/correlations.ts", "src/lib/daily-score-load.ts"]) {
      expect(code(f), `${f} must let the check-in win`).toMatch(/mood == null/)
    }
    expect(code("src/lib/claude.ts"))
      .toContain("checkinByDay.get(d)?.mood ?? moodByDay.get(d)")
  })
})

describe("the check-in stays reachable now that it owns the question", () => {
  it("Home links to it while the day's is undone", () => {
    // It lost its bottom-nav tab in the same breath as gaining sole ownership
    // of mood. If nothing on Home pointed at it, mood would be four taps and
    // a drawer away.
    expect(src("src/components/dashboard/MobileToday.tsx")).toContain('href="/dashboard/checkin"')
    expect(src("src/app/dashboard/page.tsx")).toContain('href="/dashboard/checkin"')
  })
})

describe("nothing ships a release note about a release that has shipped", () => {
  it("the V3 launch banner is gone, not just hidden", () => {
    const layout = readdirSync("src/components/layout")
    expect(layout, "a dismissed banner still renders for anyone who never dismissed it")
      .not.toContain("WhatsNewBanner.tsx")
    expect(code("src/components/layout/DashboardShell.tsx")).not.toContain("WhatsNewBanner")
  })

  it("no dashboard component announces the Play Store launch", () => {
    const dirs = ["src/components/layout", "src/components/dashboard"]
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter(n => n.endsWith(".tsx"))) {
        expect(src(join(dir, f)), `${f} still carries the V3 launch copy`)
          .not.toContain("Play Store launch")
      }
    }
  })
})
