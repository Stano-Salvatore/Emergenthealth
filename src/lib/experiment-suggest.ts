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
  // The sleep panel's gate cards end in the cause, not the outcome; the
  // outcome is always the sleep score. Its aspects end in the aspect key.
  [/^sleep_panel_(?:caffeine|late_caffeine|alcohol|bedtime)$/, "sleepScore", "sleep score"],
  [/_deep_sleep$/, "deepSleep", "deep sleep"],
  [/_rem_sleep$/, "remSleep", "REM sleep"],
  [/_deep$/, "deepSleep", "deep sleep"],
  [/_rem$/, "remSleep", "REM sleep"],
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
  // Not the place cards (`sleep_panel_caffeine_at_<place>`): both of their
  // sides had caffeine, so "no caffeine" would test something the card
  // never measured.
  [/^sleep_panel_caffeine(?!_at_)/, t => (t ? `No caffeine over ${t}` : "No caffeine")],
  // The chip is "nights begun after 23:30", so the figure is the cut the card
  // used — not a bedtime picked here, which would be someone else's clock.
  [/^sleep_panel_bedtime/, t => (t ? `Lights out before ${t}` : "An earlier bedtime")],
  [/^alcohol_/, () => "No alcohol"],
  [/^sleep_panel_alcohol/, () => "No alcohol"],
  [/^food_late_meal_/, t => (t ? `Last meal before ${t}` : "An earlier last meal")],
  [/^screen_/, t => (t ? `Under ${t} of screen time` : "Less screen time")],
  [/^late_music_/, t => (t ? `No music after ${t}` : "No music late in the evening")],
  [/^workout_/, t => (t ? `A workout of ${t} or more` : "A workout")],
  [/^activity_/, t => (t ? `${t} or more` : "A more active day")],
  [/^walking_/, t => (t ? `${t} of walking` : "A long walk")],
  [/^water_/, t => (t ? `${t} of water` : "More water")],
  [/^fasting_/, t => (t ? `A ${t} fast` : "A fast")],
]

// ── Interaction cards ─────────────────────────────────────────────────────────
//
// Every other id in the engine ends in what it measured. The combination cards
// do not: theirs read `combo_<outcome>_<condition>_<condition>`, with the
// outcome at the FRONT. The suffix table above matched nothing on them, so not
// one interaction card ever offered an experiment — including the ones the
// weekly email leads with.
//
// Their action has to be built ingredient by ingredient, too. A card that split
// on alcohol AND a short night was never a card about alcohol, so a "No alcohol"
// experiment would answer a question it never asked: the ON day is the whole
// conjunction or nothing. Which means one ingredient nobody can switch on and
// off — a busy calendar, a stressful day, a day away from home — sinks the
// suggestion rather than shrinking it down to the rest.
export const COMBO_OUTCOME: Record<string, [string, string]> = {
  sleep: ["sleepScore", "sleep score"],
  hrv: ["hrv", "HRV"],
  readiness: ["readiness", "readiness"],
  energy: ["energy", "morning energy"],
  mood: ["mood", "morning mood"],
}

// correlations.ts' COMBO_CONDITIONS, in its order — which is the order both the
// id and the group label follow. null is an exposure the user does not choose.
// A guard test reads this table and the one above back against that file: a
// condition or outcome added there and missed here is exactly how these cards
// lost their button in the first place.
export const COMBO_CONDITION: [string, ((t: string | null) => string) | null][] = [
  ["alcohol", () => "no alcohol"],
  ["caffeine", t => (t ? `no caffeine over ${t}` : "no caffeine")],
  ["late_meal", () => "an earlier last meal"],
  ["short_night", () => "a full night"],
  ["workout", () => "a workout"],
  ["hydrated", t => (t ? `${t} of fluid` : "more fluid")],
  ["busy", null],
  ["screen", t => (t ? `under ${t} of screen time` : "less screen time")],
  ["stress", null],
  ["away", null],
]

/**
 * `alcohol_short_night` → ["alcohol", "short_night"].
 *
 * Two of the keys carry an underscore of their own, so the tail cannot just be
 * split on one. It is read left to right against the table instead, and an
 * unknown key abandons the whole id rather than guessing where it ended — a new
 * condition in correlations.ts should cost a missing button, not a wrong one.
 */
function comboConditions(tail: string): string[] | null {
  const keys: string[] = []
  for (let at = 0; at < tail.length; ) {
    const hit = COMBO_CONDITION.find(
      ([k]) => tail.startsWith(k, at) && (at + k.length === tail.length || tail[at + k.length] === "_"),
    )
    if (!hit) return null
    keys.push(hit[0])
    at += hit[0].length + 1
  }
  return keys.length ? keys : null
}

/**
 * The card's own phrases, one per condition, in the id's order.
 *
 * The label reads "days with alcohol and 150mg+ of caffeine" — built from the
 * same array the id was, so the parts line up. When they don't, every threshold
 * comes back null and the action names no figure, which is the standing rule
 * here: vaguer beats confidently wrong.
 */
function comboThresholds(highGroupLabel: string, count: number): (string | null)[] {
  const parts = highGroupLabel.replace(/^days with /i, "").split(/, | and /)
  if (parts.length !== count) return Array(count).fill(null)
  return parts.map(thresholdIn)
}

const andList = (parts: string[]) =>
  parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`

function comboSuggestion(outcomeKey: string, tail: string, highGroupLabel: string): ExperimentSuggestion | null {
  const outcome = COMBO_OUTCOME[outcomeKey]
  const keys = comboConditions(tail)
  if (!outcome || !keys) return null
  const thresholds = comboThresholds(highGroupLabel, keys.length)
  const parts: string[] = []
  for (let i = 0; i < keys.length; i++) {
    const phrase = COMBO_CONDITION.find(([k]) => k === keys[i])?.[1]
    if (!phrase) return null
    parts.push(phrase(thresholds[i]))
  }
  const joined = andList(parts)
  const action = joined.charAt(0).toUpperCase() + joined.slice(1)
  const [key, outcomeLabel] = outcome
  return { name: `${action} → ${outcomeLabel}`.slice(0, 80), action, outcome: key, outcomeLabel }
}

export function experimentSuggestion(insight: Pick<InsightResult, "id" | "highGroupLabel">): ExperimentSuggestion | null {
  const combo = insight.id.match(/^combo_([a-z]+)_(.+)$/)
  if (combo) return comboSuggestion(combo[1], combo[2], insight.highGroupLabel)
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
