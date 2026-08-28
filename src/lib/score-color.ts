// The one place a 0–100 score becomes a colour.
//
// There were four scales before this, and they disagreed: the same 84 was lime
// on the mobile dashboard, amber on the Health page and yellow in TodayCard —
// so the same number changed colour depending on which screen you read it on.
// One of those, `#a3e635`, is the *move* identity hue, which per
// design/handoff/README.md must never do status duty: mixing the two palettes
// is exactly what makes a colour stop meaning anything.
//
// So: three steps, nothing else, matching the handoff's status palette. A
// fourth band would be a fourth colour with no name in the system, which is how
// the drift started.

export type ScoreStatus = "on" | "watch" | "off"

/** Status hexes, straight from design/handoff/README.md. For SVG strokes. */
export const STATUS_HEX: Record<ScoreStatus, string> = {
  on: "#34d399",
  watch: "#fbbf24",
  off: "#f87171",
}

/** The same three, as text classes, for figures and labels. */
export const STATUS_TEXT: Record<ScoreStatus, string> = {
  on: "text-emerald-400",
  watch: "text-amber-400",
  off: "text-red-400",
}

/** Nothing synced yet — neutral, not "off target". A missing score is not a bad one. */
export const SCORE_EMPTY_HEX = "#3f3f46"

/**
 * The band a 0–100 score falls in. 85 and 70 are the thresholds every one of
 * the old scales already agreed on; only the colours differed.
 */
export function scoreStatus(score: number): ScoreStatus {
  if (score >= 85) return "on"
  if (score >= 70) return "watch"
  return "off"
}

/** Ring/stroke colour for a score, or the neutral track when there is none. */
export function scoreHex(score: number | null | undefined): string {
  return score == null ? SCORE_EMPTY_HEX : STATUS_HEX[scoreStatus(score)]
}

/**
 * Text class for a score. A missing score gets `whenEmpty` — most callers want
 * muted rather than nothing, and none of them want it to read as "off target".
 */
export function scoreText(score: number | null | undefined, whenEmpty = ""): string {
  return score == null ? whenEmpty : STATUS_TEXT[scoreStatus(score)]
}

/**
 * The night's verdict as a status colour.
 *
 * Not a 0–100 score, so it keeps its own thresholds, but it was written out
 * longhand in four components with three different greens and yellows between
 * them. Same three colours as everything else now.
 */
export function sleepVerdictText(adequate: boolean | null | undefined, hours: number | null | undefined): string {
  if (adequate === true) return STATUS_TEXT.on
  if (adequate === false && (hours ?? 0) >= 6) return STATUS_TEXT.watch
  return STATUS_TEXT.off
}
