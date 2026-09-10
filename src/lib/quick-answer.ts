// The questions whose answer is a lookup, not a judgement.
//
// A third of everything asked here has one true answer that the app already
// computes: what is logged today, how much beer that was, what is still in the
// body, how the week's sleep went. "How was my sleep this week?" was asked
// seven times word for word. Every one of those spent an Opus turn to read a
// number the database could hand over in a millisecond.
//
// This module decides, from the words alone, whether a message is one of
// those. It does not answer — `quick-answer-run.ts` does that — and it does
// not guess. The moment a question wants an opinion it belongs to Emergy, and
// the tell is usually one word: why, compare, affect, should, think.
//
// The line between the two:
//
//   "how was my sleep this week?"   → a table of seven nights, ours
//   "why has my sleep been rough?"  → his
//   "does coffee affect my sleep?"  → his
//   "how was my sleep? alcohol affecting sleep?"  → his, it is two questions
//
// PURE ON PURPOSE, like quick-log.ts: no database, no clock. It returns what
// to look up, and the caller looks it up.

import { fold } from "@/lib/supplement-normalize"

/** What the app was asked for. Each one maps to a loader in quick-answer-run. */
export type QuickAsk =
  /** Everything recorded today: drinks, doses, the day's fluid total. */
  | { kind: "logged_today" }
  /** One drink type's total for today — "how much beer did I log today?" */
  | { kind: "intake_total"; type: string; label: string }
  /** Today's medications and supplements. */
  | { kind: "doses_today" }
  /** Caffeine and alcohol still circulating right now. */
  | { kind: "body_now" }
  /** Last night, or the last seven nights; `debt` asks the shortfall rather than the summary. */
  | { kind: "sleep"; window: "night" | "week"; debt?: true }

/**
 * Words that turn a lookup into an argument. Any of these and the message is
 * Emergy's, however well the rest of it matches — he is the one who can weigh
 * a cause, and a scripted sentence that pretends to is worse than a slow one.
 */
const NEEDS_JUDGEMENT = /\b(?:why|how come|because|affect|affects|affecting|impact|impacts|influence|cause|causes|correlat\w*|compare|comparison|versus|vs|should|would|could|think|opinion|advice|advise|recommend|suggest|explain|mean|means|meaning|worry|worried|watch for|improve|better|worse|fix|help|best|worst thing|interesting|insight\w*|pattern\w*|trend\w*|predict)\b/

/** A drink type the app stores, with the word people use for it. */
const INTAKE_WORDS: { re: RegExp; type: string; label: string }[] = [
  { re: /\b(?:water|watter|wather|voda|hydration|fluid)\b/, type: "water", label: "water" },
  { re: /\b(?:coffee|cofee|coffe|kava|caffeine)\b/, type: "coffee", label: "coffee" },
  { re: /\b(?:beer|pivo|lager)\b/, type: "beer", label: "beer" },
  { re: /\b(?:wine|vino)\b/, type: "wine", label: "wine" },
  { re: /\b(?:tea|caj)\b/, type: "tea", label: "tea" },
  { re: /\b(?:alcohol|booze)\b/, type: "alcohol", label: "alcohol" },
]

const TODAY = /\b(?:today|so far|this morning|tonight|dnes)\b/
const HOW_MUCH = /\b(?:how much|how many|how much of)\b/
const WHAT_LOGGED = /\bwhat(?:'s| is| has| have| did)?\b.*\b(?:logged|log|logs|recorded|tracked)\b|\b(?:logged|log)\b.*\btoday\b/
const DOSE_WORDS = /\b(?:supplements?|pills?|meds?|medication|medications|medicine|tablets?|vitamins?|doses?)\b/
const BODY_NOW = /\b(?:in my (?:body|system)|in my blood|still (?:in|circulating)|body load)\b/
const RIGHT_NOW = /\b(?:right now|rn|now|currently|at the moment|atm)\b/

const SLEEP = /\b(?:sleep|slept|sleeping|spanok|spal)\b/
const WEEK = /\b(?:this week|past week|last week|last 7 days|past 7 days|seven days|7 nights|this past week)\b/
const LAST_NIGHT = /\b(?:last night|yesterday night|overnight|vcera v noci)\b/
const DEBT = /\b(?:debt|deficit|short|shortfall|behind)\b/

/**
 * The words a question starts with. Counted, not matched: one is a question,
 * two is two questions wearing one question mark.
 */
const QUESTION_STEM = /\b(?:how much|how many|how|what(?:'s|s)?|when|where|which|who)\b/g

/** The message with the noise a person types around a question taken off. */
function normalise(message: string): string {
  return fold(message)
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/(?:^|\s)(?::-?[)(dp]|;-?\)|xd)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Read a message as a question the app can answer from its own data, or return
 * null so it goes to Emergy.
 *
 * Refuses on sight: anything long, anything asking two things, anything with a
 * word from NEEDS_JUDGEMENT. The cost of being wrong is asymmetric — a slow
 * correct answer is fine, a fast confident wrong one is not.
 */
export function parseQuickAsk(message: string): QuickAsk | null {
  if (!message) return null
  const raw = message.trim()
  if (raw.length > 120) return null

  // Two questions in one message is a conversation, not a lookup.
  if ((raw.match(/\?/g) ?? []).length > 1) return null

  const text = normalise(raw)
  if (!text) return null
  if (NEEDS_JUDGEMENT.test(text)) return null

  // "what did I eat today and how much water?" asks two things and only ends
  // with one question mark. Two question words is the tell.
  if ((text.match(QUESTION_STEM) ?? []).length > 1) return null

  // Sleep, the most asked thing here by a distance.
  if (SLEEP.test(text)) {
    const week = WEEK.test(text)
    const night = LAST_NIGHT.test(text)
    // A window has to be stated. "How was my sleep?" could mean last night or
    // lately, and the two answers differ enough that guessing is not on.
    if (week && night) return null
    if (DEBT.test(text) && (week || !night)) return { kind: "sleep", window: "week", debt: true }
    if (week) return { kind: "sleep", window: "week" }
    if (night) return { kind: "sleep", window: "night" }
    return null
  }

  // Everything else here is about today, and says so.
  if (!TODAY.test(text) && !RIGHT_NOW.test(text) && !BODY_NOW.test(text)) return null

  if (BODY_NOW.test(text)) return { kind: "body_now" }

  if (DOSE_WORDS.test(text)) return { kind: "doses_today" }

  const drink = INTAKE_WORDS.find(w => w.re.test(text))
  if (drink && HOW_MUCH.test(text)) return { kind: "intake_total", type: drink.type, label: drink.label }

  // "what's logged today?" — but not "what's logged today about coffee", which
  // is the question above and would have matched it.
  if (!drink && WHAT_LOGGED.test(text)) return { kind: "logged_today" }

  return null
}
