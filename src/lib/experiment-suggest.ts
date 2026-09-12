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

/**
 * The threshold the card in front of the user actually used.
 *
 * Reads it off the group label, which is where the engine already prints it —
 * "150mg+ caffeine days", "2L+ water days", "last meal after 20:00", "high
 * screen days (4.2h+)". Returns null when the label carries no figure, and
 * the action then avoids naming one.
 */
function thresholdIn(label: string): string | null {
  const m = label.match(/\b\d[\d.,]*\s*(?:mg|ml|L\b|h\b|hrs?\b|min\b|k\b|steps\b)|\b\d{1,2}:\d{2}\b/i)
  return m ? m[0].trim() : null
}

/**
 * Each action is built from the card it sits under, not from a number typed
 * here.
 *
 * These used to be fixed strings, and they disagreed with the cards they were
 * attached to: "No caffeine after 14:00" under a card about 16:00, "Two litres
 * of water" under a personal cut that might be 1.5L, "Last meal before 19:00"
 * under one that split at 20:00. correlations.ts states the rule this broke —
 * a card never claims a threshold it did not use — and this file is one import
 * away from it.
 *
 * "No screens after 21:30" was worse than wrong: the screen-time cards split
 * on how LONG the screen was on, never on when, so the suggested experiment
 * tested something the card had not measured.
 */
const ACTION_BY_PREFIX: [RegExp, (t: string | null) => string][] = [
  [/^caffeine_/, t => (t ? `No caffeine over ${t}` : "No caffeine")],
  [/^sleep_panel_late_caffeine/, t => (t ? `No caffeine after ${t}` : "No caffeine late in the day")],
  [/^alcohol_/, () => "No alcohol"],
  [/^food_late_meal_/, t => (t ? `Last meal before ${t}` : "An earlier last meal")],
  [/^screen_/, t => (t ? `Under ${t} of screen time` : "Less screen time")],
  [/^late_music_/, t => (t ? `No music after ${t}` : "No music late in the evening")],
  [/^workout_/, t => (t ? `A workout of ${t} or more` : "A workout")],
  [/^activity_/, t => (t ? `${t} or more` : "A more active day")],
  [/^walking_/, t => (t ? `${t} of walking` : "A long walk")],
  [/^water_/, t => (t ? `${t} of water` : "More water")],
  [/^fasting_/, t => (t ? `A ${t} fast` : "A fast")],
]

export function experimentSuggestion(insight: Pick<InsightResult, "id" | "highGroupLabel">): ExperimentSuggestion | null {
  const outcome = OUTCOME_BY_SUFFIX.find(([re]) => re.test(insight.id))
  if (!outcome) return null
  let action: string | null = null
  const byPrefix = ACTION_BY_PREFIX.find(([re]) => re.test(insight.id))
  if (byPrefix) action = byPrefix[1](thresholdIn(insight.highGroupLabel))
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
