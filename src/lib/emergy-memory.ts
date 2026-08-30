// What Emergy knows about you, and how that changes.
//
// The `remember` tool could only ever ADD. Tell him you are training for a
// marathon and he keeps it; tell him a year later that you stopped, and he
// keeps that too — both, side by side, in the prompt for every conversation
// after. The older one does not merely go stale, it actively misleads, and
// nothing in the chat could remove it. The only cure was Settings, which
// means noticing the problem, going to look, and knowing which line caused
// the odd remark.
//
// So a fact can now be replaced and forgotten from inside the conversation
// where the correction actually happens, and it carries the date he learned
// it, so "you said in March" is available to him and recency is visible.
//
// Everything here is pure: the storage is a single UserPreference row, and
// the interesting decisions — is this the same fact said differently, which
// fact did they mean — are exactly what wants testing.

/** The single UserPreference row all of this lives in. */
export const MEMORY_KEY = "emergy_memory"

export interface MemoryFact {
  fact: string
  /** YYYY-MM-DD he learned it, or null for the ones stored before dates existed. */
  at: string | null
}

/** Longest a fact may be. A paragraph is a journal entry, not something to recall. */
export const MAX_FACT_LEN = 280

/** How many facts to keep. Beyond this the oldest fall off the end. */
export const MAX_FACTS = 50

/**
 * Read the stored value, in either shape it has ever had.
 *
 * Facts used to be a bare array of strings. Those rows still exist and must
 * keep working — a migration that dropped them would delete everything Emergy
 * knew about the user to add a date field to it.
 */
export function parseFacts(value: string | null | undefined): MemoryFact[] {
  if (!value) return []
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return [] }
  if (!Array.isArray(parsed)) return []

  const out: MemoryFact[] = []
  for (const entry of parsed) {
    if (typeof entry === "string") {
      if (entry.trim()) out.push({ fact: entry.trim(), at: null })
      continue
    }
    if (entry && typeof entry === "object") {
      const fact = (entry as { fact?: unknown }).fact
      const at = (entry as { at?: unknown }).at
      if (typeof fact === "string" && fact.trim()) {
        out.push({ fact: fact.trim(), at: typeof at === "string" && at ? at : null })
      }
    }
  }
  return out
}

export function serialiseFacts(facts: MemoryFact[]): string {
  return JSON.stringify(facts)
}

/** Words too common to tell one fact from another. */
const WEAK_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "they", "their", "them", "has", "have",
  "had", "was", "were", "are", "not", "but", "you", "your", "his", "her", "its", "it's",
  "about", "from", "into", "over", "user", "likes", "like",
])

/**
 * Crude suffix stripping, so a fact restated in a different tense is still the
 * same fact.
 *
 * "I hate mornings" and "hates mornings" differ by one letter and were
 * therefore stored as two separate memories, which is precisely the duplicate
 * this is here to catch. This does not have to be linguistically right — it
 * has to be CONSISTENT, since both sides of every comparison go through it.
 */
function stem(word: string): string {
  let w = word
  const strip = (suffix: string) => {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) w = w.slice(0, -suffix.length)
  }
  // Sequentially, not first-match. Trying "es" before "s" took "hates" down to
  // "hat" while "hate" stayed whole, so the very pair this exists to merge did
  // not merge. Plural first, then tense, then a trailing "e" so that "hates" →
  // "hate" → "hat" and "hate" → "hat" land in the same place — as do "boxes"
  // and "box".
  strip("s")
  strip("ing")
  strip("ed")
  strip("e")
  return w
}

/**
 * The content words of a fact, for comparing one to another.
 *
 * Numbers are kept whatever their length. Dropping short tokens made "sleeps 7
 * hours" and "sleeps 9 hours" the same fact — and in a fact about a dose, an
 * hour or a weight, the number is the entire content of it.
 */
function keyWords(fact: string): Set<string> {
  return new Set(
    fact
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(w => (w.length >= 3 || /^\d+$/.test(w)) && !WEAK_WORDS.has(w))
      .map(w => (/^\d+$/.test(w) ? w : stem(w))),
  )
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  // Against the SMALLER set, so a short fact fully contained in a longer one
  // ("hates mornings" inside "hates mornings, especially in winter") scores as
  // the same fact rather than being diluted by the extra words.
  return shared / Math.min(a.size, b.size)
}

/**
 * Two facts are the same fact if they are mostly the same content words.
 *
 * Not exact-string equality, which was the old rule: "I hate mornings" and
 * "hates mornings" are one fact said twice, and storing both spends two of
 * fifty slots to say one thing and makes the prompt read like a stutter.
 */
export const SAME_FACT_OVERLAP = 0.8

/**
 * Add a fact, replacing one it restates.
 *
 * The replacement keeps the NEW wording and the NEW date: if the user says it
 * again, the way they say it now is the way they mean it now.
 */
export function addFact(facts: MemoryFact[], fact: string, at: string): MemoryFact[] {
  const clean = fact.trim().slice(0, MAX_FACT_LEN)
  if (!clean) return facts

  const words = keyWords(clean)
  const kept = facts.filter(f => overlap(keyWords(f.fact), words) < SAME_FACT_OVERLAP)
  return [...kept, { fact: clean, at }].slice(-MAX_FACTS)
}

export interface ForgetResult {
  facts: MemoryFact[]
  /** The one that went, or null when nothing did. */
  removed: MemoryFact | null
  /** Set when several facts matched equally well and none was removed. */
  ambiguous: MemoryFact[]
}

/**
 * Forget the fact the user meant — or, when that is not clear, forget nothing
 * and say which ones it could have been.
 *
 * Deleting the wrong memory is worse than deleting none: the user does not
 * find out until Emergy says something odd weeks later, by which time the
 * cause is invisible. Ambiguity therefore stops the operation rather than
 * guessing, and the caller asks.
 */
export function forgetFact(facts: MemoryFact[], query: string): ForgetResult {
  const words = keyWords(query)
  if (words.size === 0) return { facts, removed: null, ambiguous: [] }

  const scored = facts
    .map(f => ({ f, score: overlap(keyWords(f.fact), words) }))
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { facts, removed: null, ambiguous: [] }

  // A clear winner, or a tie. A tie is ambiguity even at a high score.
  const best = scored[0]
  const tied = scored.filter(x => x.score === best.score)
  if (tied.length > 1) return { facts, removed: null, ambiguous: tied.map(x => x.f) }

  return {
    facts: facts.filter(f => f !== best.f),
    removed: best.f,
    ambiguous: [],
  }
}

/**
 * How the facts appear in the system prompt.
 *
 * Dated, because when he learned something bears on how much it still holds —
 * "you told me in March that you were training" is a different claim from
 * "you are training", and only one of them survives the user having stopped.
 */
export function renderFacts(facts: MemoryFact[]): string {
  return facts
    .map(f => (f.at ? `- ${f.fact} (told me ${f.at})` : `- ${f.fact}`))
    .join("\n")
}
