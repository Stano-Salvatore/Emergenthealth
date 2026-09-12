// A lint for the sentences the correlation engine writes.
//
// Every other string in this app was typed by a person. The insight cards are
// assembled at runtime from a template plus a group label, and nobody ever
// read the result out loud — which is how the product shipped "After some
// caffeine after 16:00 the night scores 62.9", "The day after drinking don't
// bring more headache", and "Headache runs at 2.4/5 150mg+ caffeine days".
//
// The rules below are deliberately narrow. A lint that fired on a sentence
// which is merely unusual would be argued with and then switched off; these
// fire only on constructions that are wrong however you read them, plus the
// two word-lists the app already enforces one layer over (`quick-answer`
// bans verdicts, and statistics vocabulary has no business on a card).

export type Problem = { kind: string; detail: string }

const PREPOSITION = "after|before|on|in|during|with|without|under|over"

/**
 * Two prepositions in a row — "after under 150mg", "After days with a drink".
 * Always a stumble, never intentional.
 */
const ADJACENT = new RegExp(`\\b(?:${PREPOSITION})\\s+(?:after|before|on|in|during|under|over)\\b`, "i")

/**
 * The same preposition twice inside one clause, with no comma, semicolon,
 * dash or "vs" to break it — "After some caffeine after 16:00 the night…".
 *
 * The clause break is the whole rule. "After 7h+ sleep, mood averages 3.8 vs
 * 3.1 after shorter nights" repeats "after" across a comparison and reads
 * fine, so what matters is the gap, not the repetition.
 */
const REPEATED_IN_CLAUSE = new RegExp(`\\b(${PREPOSITION})\\b[^.;,—]*?\\b\\1\\b`, "i")

/**
 * A prepositional phrase used as a plural subject: "The day after drinking
 * don't bring more headache". Five of the eight symptom suspects produced
 * this, because the label is a phrase and the template assumed a plural noun.
 */
const SUBJECT_DISAGREES = /^(?:after|on|before|while|the day after)\b[^.;]*?\bdon't\b/i

/** "2.4/5 150mg+ caffeine days" — a missing preposition collides two numbers. */
const NUMBERS_COLLIDE = /\d(?:\/\d+)?\s+\d/

/**
 * Verdicts. The same rule `quick-answer.test.ts` enforces on the scripted
 * answers: reporting a comparison is the job, deciding whether it is good news
 * is not. "Interestingly" is here because it editorialises a null result — the
 * one case where the engine has least business having an opinion.
 */
const VERDICT = /\b(?:interestingly|surprisingly|unfortunately|thankfully|you sleep fine|isn't buying|cost you|aren't your most|you've barely|that's (?:good|great|bad|poor)|well done|too (?:much|little)|you should|worrying|concerning)\b/i

/**
 * Statistics that belong in the comments, not on a card. The engine's method
 * is not the finding, and a reader who must first be taught "permutation" to
 * understand a sentence about their coffee has been handed the wrong sentence.
 */
const JARGON = /\b(?:permutation|p-value|sample size|baseline|statistically|benjamini|the chance test|the matched window|top third|n=)\b/i

/** Sentences this long stop being read. */
export const MAX_WORDS = 25

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/**
 * Split into sentences. A decimal point never has whitespace after it, so
 * "3.8 vs 3.1" survives without any special handling.
 */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
}

/** Every problem in one user-visible string. Empty means it reads. */
export function lintSentence(text: string): Problem[] {
  const found: Problem[] = []
  const add = (kind: string, detail: string) => found.push({ kind, detail })

  // Clause by clause, so a comparison that legitimately repeats a preposition
  // on either side of "vs" is not mistaken for a stacked one.
  for (const clause of text.split(/[;—]| vs /)) {
    const adjacent = ADJACENT.exec(clause)
    if (adjacent) add("adjacent prepositions", `"${adjacent[0]}"`)
    const repeated = REPEATED_IN_CLAUSE.exec(clause)
    if (repeated) add("preposition repeated in one clause", `"${repeated[0]}"`)
  }

  if (SUBJECT_DISAGREES.test(text.trim())) add("subject does not agree with its verb", text.trim())

  const collide = NUMBERS_COLLIDE.exec(text)
  if (collide) add("two numbers with nothing between them", `"${collide[0]}"`)

  const verdict = VERDICT.exec(text)
  if (verdict) add("verdict", `"${verdict[0]}"`)

  const jargon = JARGON.exec(text)
  if (jargon) add("statistics on screen", `"${jargon[0]}"`)

  for (const s of sentences(text)) {
    if (wordCount(s) > MAX_WORDS) add("sentence too long", `${wordCount(s)} words: "${s.trim()}"`)
  }

  return found
}

/** Formats failures into an assertion message that says what to fix. */
export function describeProblems(label: string, text: string, problems: Problem[]): string {
  return [
    `${label} does not read:`,
    `  "${text}"`,
    ...problems.map(p => `  · ${p.kind} — ${p.detail}`),
  ].join("\n")
}
