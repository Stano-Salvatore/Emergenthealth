// Pure helpers for the shape of a chat transcript sent to the model.

/**
 * A history window that starts on a user turn.
 *
 * The chat keeps the last twenty turns. Sliced blindly, that window can open
 * on an assistant turn — and a conversation handed to the API that begins
 * with the assistant is rejected outright (400), which surfaced as Emergy
 * "not answering" exactly once every twenty messages in a long thread.
 */
export function trimToUserTurn<T extends { role: "user" | "assistant" }>(history: T[]): T[] {
  const first = history.findIndex(m => m.role === "user")
  return first === -1 ? [] : history.slice(first)
}

/**
 * Silence after which a turn says when it was sent. Shorter than a night, so
 * a conversation picked up the next morning always reads as the next morning.
 */
export const GAP_NOTE_HOURS = 3

type TimedTurn = { role: "user" | "assistant"; content: string; at?: string | Date | null }

/**
 * Dates the user turns that come after a gap, and says how long it has been
 * before the current message.
 *
 * History reached the model with no times at all, so a conversation left open
 * overnight read as one sitting: yesterday's pending question looked current
 * and a true "coffee at midnight" was corrected against this afternoon. Only
 * user turns are stamped — an assistant turn with a stamp teaches him to
 * write stamps — and a turn with no known time is left as it was.
 */
export function stampTurnGaps(
  turns: TimedTurn[], now: Date, timezone: string,
): { history: { role: "user" | "assistant"; content: string }[]; current: string } {
  const time = (v: TimedTurn["at"]) => {
    if (v == null) return null
    const t = v instanceof Date ? v.getTime() : Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone })
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" })
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
  const stamp = (t: number) => `${date.format(new Date(t)).replace(",", "")}, ${clock.format(new Date(t))}`
  const apart = (a: number, b: number) =>
    Math.abs(b - a) >= GAP_NOTE_HOURS * 3_600_000 || day.format(new Date(a)) !== day.format(new Date(b))

  let prev: number | null = null
  const history = turns.map(turn => {
    const t = time(turn.at)
    const out = { role: turn.role, content: turn.content }
    if (t == null) return out
    const gap = prev == null ? apart(t, now.getTime()) : apart(prev, t)
    prev = t
    return turn.role === "user" && gap ? { ...out, content: `[${stamp(t)}] ${turn.content}` } : out
  })

  let current = ""
  if (prev != null && apart(prev, now.getTime())) {
    const hours = Math.round((now.getTime() - prev) / 3_600_000)
    current = `[now ${stamp(now.getTime())} — ${hours}h since the last message] `
  }
  return { history, current }
}
