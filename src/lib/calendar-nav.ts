// Pure helpers behind the calendar's touch navigation. Kept out of the page
// component so the gesture maths is testable without a browser or a phone.

export type SwipeAction = "next" | "prev" | null

/**
 * Decide whether a touch drag should page the calendar forward, back, or do
 * nothing. `dx`/`dy` are the total travel from touch-start to touch-end in CSS
 * pixels (dx > 0 means the finger moved right).
 *
 * A swipe only counts when it is decisively horizontal — past `threshold` px
 * across AND at least `ratio`× longer horizontally than vertically — so that a
 * vertical scroll through the day grid, or a lazy diagonal, never yanks you to
 * another week. Moving the finger right (dx > 0) reveals the period to the
 * left, i.e. goes to the previous period, matching every native calendar.
 */
export function swipeAction(
  dx: number,
  dy: number,
  threshold = 56,
  ratio = 1.5,
): SwipeAction {
  if (Math.abs(dx) < threshold) return null
  if (Math.abs(dx) < Math.abs(dy) * ratio) return null
  return dx < 0 ? "next" : "prev"
}
