// Training load, the session-RPE way, and what readiness says to do today.
//
// Load = minutes × perceived effort (1–10). It's the Foster method — crude,
// but it works for a weight session and a run alike, needs no heart-rate
// strap, and is what the acute:chronic ratio in the sports literature is
// usually computed from. Strava rows without an effort score get a 5.

export interface LoadSession {
  /** YYYY-MM-DD */
  day: string
  minutes: number
  /** 1–10, null for synced activities with no score. */
  rpe: number | null
}

export type LoadTrend = "resting" | "easing" | "steady" | "building" | "spiking"

export interface TrainingLoad {
  /** Sum of load over the last 7 days. */
  acute: number
  /** Average weekly load over the last 28 days. */
  chronicWeekly: number
  /** acute ÷ chronicWeekly, null when there is no chronic base. */
  ratio: number | null
  trend: LoadTrend
  sessions7d: number
  minutes7d: number
  sessions28d: number
  summary: string
}

const DEFAULT_RPE = 5

export function sessionLoad(minutes: number, rpe: number | null | undefined): number {
  const m = Math.max(0, minutes)
  const r = rpe != null && rpe >= 1 && rpe <= 10 ? rpe : DEFAULT_RPE
  return Math.round(m * r)
}

function dayIndex(date: string): number {
  return Math.floor(Date.parse(date + "T00:00:00Z") / 86_400_000)
}

/** `today` is the user's local date; sessions after it are ignored. */
export function trainingLoad(sessions: LoadSession[], today: string): TrainingLoad {
  const t = dayIndex(today)
  let acute = 0, chronic = 0, s7 = 0, m7 = 0, s28 = 0
  for (const s of sessions) {
    const age = t - dayIndex(s.day)
    if (age < 0 || age >= 28) continue
    const load = sessionLoad(s.minutes, s.rpe)
    chronic += load
    s28++
    if (age < 7) { acute += load; s7++; m7 += s.minutes }
  }
  const chronicWeekly = Math.round(chronic / 4)
  const ratio = chronicWeekly > 0 ? Math.round((acute / chronicWeekly) * 100) / 100 : null

  let trend: LoadTrend
  if (s28 === 0 || (acute === 0 && chronicWeekly === 0)) trend = "resting"
  else if (ratio == null) trend = "building"
  else if (ratio < 0.8) trend = "easing"
  else if (ratio <= 1.3) trend = "steady"
  else if (ratio <= 1.5) trend = "building"
  else trend = "spiking"

  const summary = {
    resting: "No sessions in the last four weeks.",
    easing: `Lighter week than usual — ${s7} session${s7 === 1 ? "" : "s"}, ${m7} min. Good if it's planned recovery.`,
    steady: `Steady load — ${s7} session${s7 === 1 ? "" : "s"}, ${m7} min this week, in line with your four-week average.`,
    building: s28 > 0 && ratio == null
      ? `First sessions on record — ${s7} this week.`
      : `Building — this week is ${Math.round(((ratio ?? 1) - 1) * 100)}% above your four-week average. Fine as a step up, not as a new normal yet.`,
    spiking: `Sharp jump — this week's load is ${ratio}× your four-week average. Injury risk climbs past 1.5; keep the next few days easy.`,
  }[trend]

  return { acute, chronicWeekly, ratio, trend, sessions7d: s7, minutes7d: m7, sessions28d: s28, summary }
}

export type SessionSuggestion = "hard" | "moderate" | "easy" | "rest"

export interface ReadinessSuggestion {
  suggestion: SessionSuggestion
  reason: string
}

/**
 * What kind of session today's readiness supports, relative to the user's
 * own recent readiness rather than a fixed scale — a 70 is a good day for
 * one person and a slump for another. Load overrides: a spiking week is a
 * rest day whatever the ring says.
 */
export function suggestSession(
  readiness: number | null,
  recentReadiness: number[],
  load: TrainingLoad,
): ReadinessSuggestion {
  if (load.trend === "spiking") {
    return { suggestion: "rest", reason: "Load spiked this week — a rest or a walk protects the gains you already made." }
  }
  if (readiness == null) {
    return load.trend === "building"
      ? { suggestion: "moderate", reason: "No readiness score today; load is already climbing, so keep it moderate." }
      : { suggestion: "moderate", reason: "No readiness score today — go by feel, moderate is the safe default." }
  }
  const sorted = [...recentReadiness].filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  const median = sorted.length >= 5 ? sorted[Math.floor(sorted.length / 2)] : 70
  const delta = readiness - median

  if (readiness < 55 || delta <= -12) {
    return { suggestion: "rest", reason: `Readiness ${readiness} is well under your usual ${median}. Rest or an easy walk.` }
  }
  if (delta <= -5) {
    return { suggestion: "easy", reason: `Readiness ${readiness}, a little under your usual ${median}. Keep it easy — technique, mobility, a short jog.` }
  }
  if (delta >= 5 && load.trend !== "building") {
    return { suggestion: "hard", reason: `Readiness ${readiness}, above your usual ${median}. Good day for the hard session.` }
  }
  return { suggestion: "moderate", reason: `Readiness ${readiness}, about your usual. A normal session.` }
}
