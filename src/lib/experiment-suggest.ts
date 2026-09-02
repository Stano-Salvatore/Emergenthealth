// "Test this" — from a correlation card to a pre-filled experiment.
//
// The engine can say caffeine days sleep worse; only an experiment can say
// whether cutting caffeine helps. Every insight with an exposure the user
// controls gets a one-tap way to ask that question properly. The action is
// phrased as the thing to do on ON days: abstain from the harmful ones, do the
// helpful ones — the experiment decides which it was.

import type { InsightResult } from "@/lib/correlations"

export interface ExperimentSuggestion {
  name: string
  action: string
  outcome: string
  outcomeLabel: string
}

const OUTCOME_BY_SUFFIX: [RegExp, string, string][] = [
  [/_deep_sleep$/, "deepSleep", "deep sleep"],
  [/_rem_sleep$/, "remSleep", "REM sleep"],
  [/_resting_hr$/, "restingHR", "resting heart rate"],
  [/_sleep$/, "sleepScore", "sleep score"],
  [/_duration$/, "sleepDuration", "sleep length"],
  [/_hrv$/, "hrv", "HRV"],
  [/_readiness$/, "readiness", "readiness"],
  [/_energy$/, "energy", "morning energy"],
  [/_mood$/, "mood", "morning mood"],
]

const ACTION_BY_PREFIX: [RegExp, string][] = [
  [/^caffeine_/, "No caffeine after 14:00"],
  [/^alcohol_/, "No alcohol"],
  [/^food_late_meal_/, "Last meal before 19:00"],
  [/^screen_/, "No screens after 21:30"],
  [/^late_music_/, "No music after 22:00"],
  [/^workout_/, "A 20-minute-plus workout"],
  [/^activity_/, "8,000-plus steps"],
  [/^walking_/, "A 30-minute walk"],
  [/^water_/, "Two litres of water"],
  [/^fasting_/, "A 16-hour fast"],
]

export function experimentSuggestion(insight: Pick<InsightResult, "id" | "highGroupLabel">): ExperimentSuggestion | null {
  const outcome = OUTCOME_BY_SUFFIX.find(([re]) => re.test(insight.id))
  if (!outcome) return null
  let action: string | null = null
  const byPrefix = ACTION_BY_PREFIX.find(([re]) => re.test(insight.id))
  if (byPrefix) action = byPrefix[1]
  else if (/^supplement_/.test(insight.id)) {
    // A prescription modelled by half-life ("still on board") is a doctor's
    // call, not something to switch on and off for a fortnight.
    if (/still on board/i.test(insight.highGroupLabel)) return null
    const name = insight.highGroupLabel.replace(/ days$/i, "").replace(/\s*\(.*$/, "").trim()
    if (!name) return null
    action = `Take ${name}`
  }
  if (!action) return null
  const [, outcomeKey, outcomeLabel] = outcome
  return { name: `${action} → ${outcomeLabel}`.slice(0, 80), action, outcome: outcomeKey, outcomeLabel }
}
