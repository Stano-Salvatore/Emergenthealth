// The figures inside a sentence, and which domain each belongs to.
//
// Emergy's replies and the daily brief are paragraphs of prose with the
// numbers buried in them — "you're running on 6.0h and 5.9h the last two
// nights", "readiness is up at 73", "1.4L of fluid" — and on a phone the eye
// slides straight past them. The palette rule (design/handoff/README.md) says
// a figure takes the hue of what it measures, on every screen; this is what
// lets prose obey it too.
//
// Identity only, never status: sleep hours are indigo whether the night was
// good or bad. A green "6.0h" would be the colour concluding what the words
// did not, which is the collision the rule exists to prevent.
//
// Pure. The renderers (ChatMarkdown, DailyBriefing) map the segments to
// spans; this file decides nothing about how they look.

export type FigureDomain = "sleep" | "heart" | "move" | "fuel" | "mind"

export interface Segment {
  text: string
  /** Set on a figure. Undefined on ordinary prose. */
  figure?: true
  /** The domain hue, when the unit or the nearby word makes it unambiguous. */
  domain?: FigureDomain
}

// Units whose domain is unambiguous on their own.
const UNIT_DOMAIN: [RegExp, FigureDomain | null][] = [
  [/^\d+h(?:\s?\d{1,2}m)?$/i, "sleep"],                           // 5h 54m, 6h
  [/^\d+(?:[.,]\d+)?\s?(?:hours?|hrs?|h)$/i, "sleep"],             // 8.5 hours, 6.0h
  [/^\d+(?:[.,]\d+)?\s?ms$/i, "heart"],                           // 122ms
  [/^\d+(?:[.,]\d+)?\s?bpm$/i, "heart"],                          // 55 bpm
  [/^\d[\d,.]*\s?k?\s?steps$/i, "move"],                          // 11.9k steps, 9,100 steps
  [/^\d+(?:[.,]\d+)?\s?km$/i, "move"],                            // 235km
  [/^\d+(?:[.,]\d+)?\s?(?:ml|mL|l|L|litres?|liters?)$/, "fuel"],  // 400ml, 1.4L
  [/^\d+(?:[.,]\d+)?\s?mg$/i, "fuel"],                            // 180mg
  [/^\d(?:[.,]\d)?\/5$/, "mind"],                                 // 5/5, 3.5/5
  [/^\d+(?:[.,]\d+)?\s?kg$/i, null],                              // body has no hue; bold only
  [/^\d+(?:[.,]\d+)?%$/, null],                                   // a share of something; bold only
  [/^\d{1,2}:\d{2}$/, null],                                      // a clock time; bold only
]

// A bare number or a "min" figure takes its domain from the words just
// before it, when one of these is there.
const KEYWORD_DOMAIN: [RegExp, FigureDomain][] = [
  [/\b(?:readiness|hrv|resting(?: heart rate)?|rhr|heart rate|spo2)\b/i, "heart"],
  [/\b(?:sleep(?: score)?|rem|deep|light sleep|asleep|in bed|night|nights)\b/i, "sleep"],
  [/\b(?:mood|energy|focus)\b/i, "mind"],
  [/\b(?:steps?|walk(?:ed|ing)?|active|moving|distance)\b/i, "move"],
  [/\b(?:water|fluid|drank|caffeine|coffee)\b/i, "fuel"],
]

// One alternation, longest forms first so "5h 54m" is not cut at "5h".
const FIGURE_RE = new RegExp(
  [
    String.raw`\d+h\s?\d{1,2}m\b`,
    String.raw`\d+(?:[.,]\d+)?\s?(?:hours|hour|hrs|hr|h)\b`,
    String.raw`\d+(?:[.,]\d+)?\s?(?:ms|bpm|km|mg|kg)\b`,
    String.raw`\d+(?:[.,]\d+)?\s?(?:ml|mL|litres?|liters?)\b`,
    String.raw`\d+(?:[.,]\d+)?L\b`,
    String.raw`\d[\d,.]*\s?k?\s?steps\b`,
    String.raw`\d+(?:[.,]\d+)?\s?(?:min|mins|minutes?)\b`,
    String.raw`\d(?:[.,]\d)?\/5\b`,
    String.raw`\d+(?:[.,]\d+)?%`,
    String.raw`\b\d{1,2}:\d{2}\b`,
    String.raw`\b\d{1,3}(?:,\d{3})+\b`,
    String.raw`\b\d+(?:\.\d+)?\b`,
  ].join("|"),
  "g",
)

const MINUTE_RE = /^\d+(?:[.,]\d+)?\s?(?:min|mins|minutes?)$/i
const BARE_RE = /^\d[\d,]*(?:\.\d+)?$/

// The words before a figure, back to the start of its sentence (capped): in
// "REM sleep averages 65 min; with an earlier start, 87 min" the second
// figure is forty characters from the word that names it.
function keywordDomain(before: string): FigureDomain | null {
  const window = before.slice(-160).split(/(?<=[.!?])\s+/).pop() ?? ""
  for (const [re, domain] of KEYWORD_DOMAIN) if (re.test(window)) return domain
  return null
}

// A number that counts things is not a measurement: "14 days", "3 nights",
// "2 patterns". Left as prose.
const COUNT_NOUN_RE = /^\s?(?:days?|nights?|weeks?|months?|years?|times?|things?|patterns?|events?|habits?|more|of)\b/i

/** Split prose into ordinary text and figures, each figure with its domain when known. */
export function markFigures(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(FIGURE_RE)) {
    const token = m[0]
    const at = m.index ?? 0
    const before = text.slice(0, at)

    let domain: FigureDomain | null | undefined
    let isFigure = true
    if (MINUTE_RE.test(token)) {
      // "65 min" is REM sleep in one sentence and a walk in the next.
      domain = keywordDomain(before)
    } else if (BARE_RE.test(token)) {
      // A bare number is a figure only when a domain word introduces it —
      // "readiness is up at 73", "mood at 5" — and never when it counts
      // something: "walking hasn't shown up in 14 days" is a count of days.
      const counts = COUNT_NOUN_RE.test(text.slice(at + token.length))
      domain = counts ? null : keywordDomain(before)
      isFigure = domain != null
    } else {
      domain = undefined
      for (const [re, d] of UNIT_DOMAIN) if (re.test(token)) { domain = d; break }
      if (domain === undefined) domain = keywordDomain(before)
    }

    if (!isFigure) continue
    if (at > last) out.push({ text: text.slice(last, at) })
    out.push({ text: token, figure: true, ...(domain ? { domain } : {}) })
    last = at + token.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Tailwind class for a figure: bold, tabular, and the domain hue when there is one. */
export function figureClass(domain?: FigureDomain): string {
  const hue = domain === "sleep" ? "text-sleep"
    : domain === "heart" ? "text-heart"
    : domain === "move" ? "text-move"
    : domain === "fuel" ? "text-fuel"
    : domain === "mind" ? "text-mind"
    : ""
  return `font-semibold tabular-nums ${hue}`.trim()
}
