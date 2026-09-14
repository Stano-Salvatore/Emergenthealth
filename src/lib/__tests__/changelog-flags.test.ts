import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { isFeatureEnabled, FEATURE_ROUTES, type FeatureKey } from "@/lib/features"

// The CHANGELOG listed eight features as "held back, flag-gated" while
// `features.ts` held back three. Five had shipped — Lab results, Strava,
// Screen time, Last.fm, RescueTime — and the release notes still told anyone
// reading that they were hidden.
//
// Nobody notices a stale doc, which is exactly why it needs a test rather than
// a resolution to be careful. This one is cheap because the held-back set is
// small and discrete: the array is the truth, the prose must agree with it.
//
// Deliberately NOT guarded: the approximate counts elsewhere in the docs
// ("~1450 tests", "~4100 lines"). A guard that fires on every legitimate
// commit gets switched off within a week and deserves to.

const changelog = readFileSync("CHANGELOG.md", "utf8")
const heldSection = changelog.slice(
  changelog.indexOf("### Held back for future updates"),
  changelog.indexOf("### Launched since V3 shipped"),
)

/** Every feature key, and whether the flag currently hides it. */
const ALL = Object.keys(FEATURE_ROUTES) as FeatureKey[]
const heldBack = ALL.filter(k => !isFeatureEnabled(k))
const launched = ALL.filter(k => isFeatureEnabled(k))

/** How each key is spelled for a reader. */
const PROSE: Record<FeatureKey, string> = {
  finances: "Finances",
  smarthome: "Smart home",
  gmail: "Gmail",
  strava: "Strava",
  lastfm: "Last.fm",
  rescuetime: "RescueTime",
  labs: "Lab results",
  screentime: "Screen time",
  fasting: "Fasting",
}

describe("the release notes agree with the flags", () => {
  it("names every feature that is actually held back", () => {
    expect(heldBack.length, "this test assumes the held-back set is small").toBeLessThan(6)
    for (const key of heldBack) {
      expect(heldSection, `${PROSE[key]} is gated in features.ts and missing from the CHANGELOG`)
        .toContain(PROSE[key])
    }
  })

  it("and names nothing that has since launched", () => {
    // The failure that actually happened: five entries outliving their flag.
    for (const key of launched) {
      expect(heldSection, `${PROSE[key]} shipped — the CHANGELOG still calls it flag-gated`)
        .not.toContain(PROSE[key])
    }
  })

  it("points at the array rather than restating it from memory", () => {
    expect(heldSection, "a list with no pointer to its source is the one that drifts")
      .toContain("features.ts")
  })

  it("suggests an override that would actually do something", () => {
    // NEXT_PUBLIC_ENABLED_FEATURES only has an effect on a held-back key;
    // naming a launched one in the example teaches a no-op.
    const example = heldSection.match(/NEXT_PUBLIC_ENABLED_FEATURES="([^"]+)"/)?.[1] ?? ""
    expect(example, "the CHANGELOG should show an override example").not.toBe("")
    for (const key of example.split(",").map(s => s.trim()).filter(Boolean)) {
      expect(heldBack, `"${key}" is not held back, so enabling it changes nothing`)
        .toContain(key as FeatureKey)
    }
  })
})
