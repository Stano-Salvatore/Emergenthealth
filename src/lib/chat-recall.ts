// Emergy remembering what the two of you said.
//
// Every message is already stored in ChatMessage; until this existed nothing
// ever read it back, so each new conversation started knowing nothing about
// the ones before it. Asked "do you remember me talking about the church
// tower", he answered — truthfully and uselessly — that he keeps no
// transcript of past chats.
//
// The searching itself is a database query. What lives here is the part that
// decides WHICH remembered exchange to surface, because that is where a recall
// tool is won or lost: a search that returns forty half-matching messages is
// no better than one that returns none.

/**
 * Words too common to identify a conversation.
 *
 * The question that triggers a recall is usually "do you remember when I told
 * you about X", and every word of that except X appears in half the
 * conversations the user has ever had. Searching on them returns everything,
 * which buries the one exchange they meant.
 */
export const RECALL_STOP_WORDS = new Set([
  "the", "and", "you", "your", "yours", "our", "with", "what", "when", "where", "which",
  "that", "this", "there", "then", "they", "them", "was", "were", "have", "has", "had",
  "did", "does", "doing", "for", "from", "about", "into", "over", "after", "before",
  "remember", "recall", "talking", "talked", "told", "said", "say", "chat", "chats",
  "conversation", "yesterday", "today", "some", "something", "anything", "idk", "like",
  "just", "can", "could", "would", "should", "maybe", "really", "much", "more", "than",
  "hey", "yes", "yeah", "okay", "not", "but", "who", "how", "why", "are", "its", "it's",
])

/** At most this many terms: past it the query is a sentence, not a search. */
const MAX_TERMS = 6

/** How many past exchanges one recall may quote. Useful, not a transcript dump. */
export const RECALL_MAX_HITS = 6

/** One message, shortened. A recalled exchange is a reminder, not a re-read. */
export function trimForRecall(content: string, max = 320): string {
  const flat = content.replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max) + "…" : flat
}

/**
 * The words in a question that are actually worth searching for.
 *
 * Unicode-aware on purpose: this user writes in Slovak, and splitting on
 * `[^a-z0-9]` would cut "Kaviareň" into "Kaviare" and lose "Blumentál"
 * entirely — the distinctive words are exactly the accented ones.
 */
export function recallTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 3 && !RECALL_STOP_WORDS.has(w))
    .filter((w, i, all) => all.indexOf(w) === i)

  if (words.length <= MAX_TERMS) return words

  // Over the limit, drop the SHORTEST words rather than the last ones. Taking
  // the first six of "hey do you remember the church tower after meeting
  // Sofia" cut "Sofia" — a name, the single most identifying word in the
  // sentence — to make room for "hey". Length is a crude proxy for how much a
  // word narrows a search, but it is the right direction, and the survivors go
  // back into the order they were written for readability.
  const keep = new Set([...words].sort((a, b) => b.length - a.length).slice(0, MAX_TERMS))
  return words.filter(w => keep.has(w))
}

export interface RecallHit {
  content: string
  createdAt: Date
}

/**
 * Pick which hits to quote, and put them back in the order they happened.
 *
 * The database returns anything matching ANY term, all equally, newest first —
 * so a message that merely says "church" outranks the one that says "church"
 * and "tower" and "Sofia", purely by being more recent. Scoring by how many
 * terms a message actually contains is what makes the right conversation come
 * back first.
 *
 * The final sort is chronological rather than by score: what gets returned is
 * read as a story, and a story out of order is harder to follow than a
 * slightly worse first line.
 */
export function rankRecallHits<T extends RecallHit>(
  hits: T[],
  terms: string[],
  max = RECALL_MAX_HITS,
): T[] {
  return hits
    .map(h => {
      const lower = h.content.toLowerCase()
      return { h, score: terms.filter(t => lower.includes(t)).length }
    })
    .sort((a, b) => b.score - a.score || b.h.createdAt.getTime() - a.h.createdAt.getTime())
    .slice(0, max)
    .sort((a, b) => a.h.createdAt.getTime() - b.h.createdAt.getTime())
    .map(x => x.h)
}
