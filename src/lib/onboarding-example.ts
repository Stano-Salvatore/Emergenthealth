// The pattern the onboarding shows a new account before it has any of its own.
//
// It is a real card's shape: the sleep panel's late-caffeine question, with the
// title, group labels and finding sentence the engine writes for it
// (correlations.ts, the "late_caffeine" sleep cause). Only the numbers are
// invented, and the step labels it as an example. The delta is the engine's
// own arithmetic on the two averages, and both sides are at the confident
// size — an example marked Solid with a thin side would teach the wrong
// thing. onboarding.test.ts holds it to all of that.

import type { Tier } from "@/components/insights/InsightParts"

export const EXAMPLE_PATTERN = {
  emoji: "🌙",
  title: "Caffeine After 16:00 & Sleep",
  finding: "Nights with caffeine after 16:00 score 71.4; nights with none after 16:00, 79",
  delta: -9.6,
  tier: "strong" as Tier,
  high: { label: "caffeine after 16:00", avg: 71.4, n: 12 },
  low: { label: "all caffeine before 16:00", avg: 79, n: 31 },
}
