// Pure helpers for reading the stored chat transcript from a chat client.
// Client-safe: no server imports.

export interface ThreadSummary { id: string; updatedAt: string }
export interface TranscriptRow { id?: string; role: "user" | "assistant"; content: string }

/**
 * The thread a chat surface opens on: the newest conversation, when it was
 * active today on this device's clock. The proactive crons append into that
 * thread too, so everything said today is in one place. "legacy" is the
 * pre-conversation bucket, which a new turn cannot be appended to.
 */
export function todaysThread(list: ThreadSummary[], now: Date = new Date()): string | null {
  const newest = list[0]
  if (!newest || newest.id === "legacy") return null
  return new Date(newest.updatedAt).toDateString() === now.toDateString() ? newest.id : null
}

/** A turn whose stream this screen lost, as far as the screen knows it. */
export interface TurnToFind {
  /** The stored user row, once the stream's first event has named it. */
  userRowId: string | null
  /** The words sent, exactly as the server stores them. */
  text: string
  /** Identical user messages the thread already held before this turn. */
  seenBefore: number
  /** The turn started a conversation of its own. */
  newThread: boolean
}

/**
 * Whether the transcript already holds the reply to this turn. "The last row
 * is an assistant" is not enough: until the server writes this turn's user
 * row, the last row is the PREVIOUS answer — and a retry of the same words
 * would take the first attempt's reply for its own.
 */
export function replyLanded(rows: TranscriptRow[], turn: TurnToFind): boolean {
  let at: number
  if (turn.userRowId) {
    at = rows.findIndex(r => r.id === turn.userRowId)
  } else {
    if (turn.newThread && !(rows[0]?.role === "user" && rows[0].content === turn.text)) return false
    const same = rows.flatMap((r, i) => (r.role === "user" && r.content === turn.text ? [i] : []))
    if (same.length <= turn.seenBefore) return false
    at = same[same.length - 1]
  }
  return at >= 0 && rows.slice(at + 1).some(r => r.role === "assistant")
}

/** Phone clocks drift from the server's; this much either way still counts as "since the turn began". */
const CLOCK_SKEW_MS = 5 * 60_000

/**
 * The conversation a brand-new chat's turn most likely landed in, when the
 * stream died before it could say: the newest one, touched since the turn
 * began. A candidate only — replyLanded confirms it.
 */
export function freshConversation(list: ThreadSummary[], startedAt: number): string | null {
  const newest = list[0]
  if (!newest || newest.id === "legacy") return null
  return new Date(newest.updatedAt).getTime() >= startedAt - CLOCK_SKEW_MS ? newest.id : null
}
