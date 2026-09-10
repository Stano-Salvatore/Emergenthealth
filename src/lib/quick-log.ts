// The logging messages that never needed a model.
//
// A fifth of everything ever said to Emergy was "log me 300ml water" in some
// spelling — "add 1L water", "log beer 0.4L 4.8% alcohol", "log me Elicea and
// 500ml of watter", "at kaviaren vtak log cold brew 250ml and watter 200ml".
// Each one went through Opus, a tool call and a reply: a few seconds and a few
// thousand tokens to write one row. This module recognises those messages
// from their shape and hands back the rows to write, so the chat route can
// answer them itself, instantly, and send everything else on to the model as
// before.
//
// The rule that keeps it honest: THE WHOLE MESSAGE MUST PARSE, OR NONE OF IT
// DOES. A message with a question mark, a word the grammar does not know, an
// unknown drink or an unfamiliar medication returns null and goes to Emergy —
// who can ask, estimate, push back, or log it with judgement. This parser
// never guesses; a wrong row written silently costs more than the tokens it
// saved. So "two beers 0.4L each" is his (a number in words), "log 300ml of
// watter — the mint one" is his (a trailing clause), "add one 400ml 5.2%
// alcohol" is his (no drink named). The grammar was written from the real
// messages, and every shape it accepts is in quick-log.test.ts.
//
// PURE ON PURPOSE — no database, no clock of its own. The caller supplies
// what the user has logged before (their medications, by name) and their
// saved places, and the parser returns rows for the caller to write. That is
// what makes it testable against the transcript it was built from.

import { fold } from "@/lib/supplement-normalize"
import { matchKey } from "@/lib/med-schedule"

export interface QuickDrink {
  kind: "drink"
  /** An IntakeLog type: water, sparkling, coffee, tea, matcha, mate, beer, wine, spirits, juice, soda, milk. */
  type: string
  amountMl: number
  /** The stored note, in the convention the model already used: "Cold brew", "Beer 12° (4.8%)", null for plain water. */
  note: string | null
  /** Alcohol by volume when the user said it — kept in the note, not a column. */
  abv: number | null
  minutesAgo: number
}

export interface QuickDose {
  kind: "dose"
  /** The name as the user has logged it before — so the history stays one substance, not two spellings. */
  name: string
  dose: { amount: number; unit: "mg" | "tablet" } | null
  minutesAgo: number
}

export type QuickItem = QuickDrink | QuickDose

export interface QuickLog {
  items: QuickItem[]
  /** The saved place named in the message, if any, as stored. */
  place: string | null
}

export interface QuickLogContext {
  /** Substances the user has logged before (manual dose tags, medication schedules). */
  knownSubstances: string[]
  /** Saved place names. */
  places: string[]
  /** Minutes since local midnight, for "at 16:10". */
  localMinutes: number
}

/** How far back "at HH:MM" and "Nh ago" may reach — past that it is a memory, not a log. */
const MAX_MINUTES_AGO = 48 * 60
const MAX_ITEMS = 8

// ── Vocabulary ─────────────────────────────────────────────────────────────
// Every drink the parser will write without asking. Anything else — a brand,
// a cocktail, "the mint one" — is the model's, who can estimate what is in it.
// Labels follow what Emergy already stored so the intake history reads as one
// hand wrote it.
interface DrinkWord {
  re: RegExp
  type: string
  label: string | null
  /** A serving the user never states a volume for. Only espresso earns one. */
  defaultMl?: number
}

const DRINKS: DrinkWord[] = [
  { re: /^(?:still |plain |tap )?(?:wat+er|watter|wattee|watr|wather|voda|h2o)$/, type: "water", label: null },
  { re: /^(?:sparkling(?: water)?|soda water|mineral water|fizzy water|bubbly water)$/, type: "sparkling", label: "Sparkling water" },
  { re: /^(?:double|dbl) (?:espresso|expresso)$/, type: "coffee", label: "Double espresso", defaultMl: 60 },
  { re: /^(?:espresso|expresso)$/, type: "coffee", label: "Espresso", defaultMl: 30 },
  { re: /^cold ?brew(?: coffee)?$/, type: "coffee", label: "Cold brew" },
  { re: /^batch(?: ?brew)?(?: coffee)?$/, type: "coffee", label: "Batch brew" },
  { re: /^v60(?: coffee)?$/, type: "coffee", label: "V60" },
  { re: /^aeropress$/, type: "coffee", label: "Aeropress" },
  { re: /^filter(?: coffee)?$/, type: "coffee", label: "Filter coffee" },
  { re: /^americano$/, type: "coffee", label: "Americano" },
  { re: /^(?:latte|caffe latte)$/, type: "coffee", label: "Latte" },
  { re: /^(?:cappuccino|capuccino|cappucino)$/, type: "coffee", label: "Cappuccino" },
  { re: /^flat ?white$/, type: "coffee", label: "Flat white" },
  { re: /^(?:coffee|cofee|coffe|kava|kavu|cafe)$/, type: "coffee", label: "Coffee" },
  { re: /^(?:green|black|herbal|mint|ginger|chamomile|earl grey)? ?(?:tea|caj|cay)$/, type: "tea", label: "Tea" },
  { re: /^matcha(?: latte)?$/, type: "matcha", label: "Matcha" },
  { re: /^(?:yerba ?)?mate$/, type: "mate", label: "Mate" },
  { re: /^(?:beer|pivo|lager|ale|ipa|pils|pilsner|radler)$/, type: "beer", label: "Beer" },
  { re: /^(?:white|red|rose|sparkling)? ?(?:wine|vino)$/, type: "wine", label: "Wine" },
  { re: /^(?:vodka|whisky|whiskey|gin|rum|tequila|spirits?|slivovica|borovicka)$/, type: "spirits", label: "Spirits" },
  { re: /^(?:orange |apple )?(?:juice|dzus)$/, type: "juice", label: "Juice" },
  { re: /^(?:cola|coke|kofola|soda|lemonade)$/, type: "soda", label: "Soda" },
  { re: /^milk$/, type: "milk", label: "Milk" },
]

/** Words the grammar lets stand between the ones that matter. */
const FILLER = /\b(?:of|the|a|an|some|one|another|my|me|all|please|pls|also|too|then|black|glass of|cup of|bottle of|can of)\b/g

/** How the message may begin, before the verb. */
const LEAD = /^(?:(?:okay|ok|okey|oh no|oh|ah|hey|hi|hello|so|and|also|now|please|pls|can you|could you|would you|emergy|emergi)[\s,.!:-]*)*/
const VERB = /^(?:(?:i )?(?:log|add|record|track|note down|note|took|had|drank|drink|drinking|having)\b)/

/** Item separators — "and", punctuation, "plus", "with" (once "with ice" is out of the way). */
const SEPARATOR = /\s*(?:,(?!\d)|;|\.(?!\d)|\band\b|\balso\b|\bplus\b|\bwith\b|&|\+|(?<!\d)-(?!\d)|–|—)\s*/

const VOLUME = /\b(\d+(?:[.,]\d+)?)\s*(ml|mls|l|litre|litres|liter|liters|cl|dl)\b/
const ABV = /\b(\d+(?:[.,]\d+)?)\s*(?:%|per\b|perc\b|percent\b)(?:\s*(?:alcohol|alc|abv|vol)\b)?/
const PLATO = /\b(\d{1,2})\s*(?:°|deg|degrees)/
const CLOCK = /\b(?:at\s+)?(\d{1,2}):(\d{2})\b/
const AGO = /\b(?:(\d+)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minute|minutes))?|(\d+)\s*(?:m|min|mins|minute|minutes)|an? hour|half an hour)\s*(?:ago|before|earlier|back)\b/
const NOW = /\b(?:time\s*[-:]?\s*)?(?:just\s+)?now\b/
const ICE = /\biced\b/
const MG = /\b(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|µg|ug|iu)\b/
const TABLETS = /\b(?:(half|quarter)(?:\s+(?:of\s+)?(?:a\s+)?(?:tablets?|tabs?|pills?))?|(\d+(?:[.,]\d+)?)\s*(?:tablets?|tabs?|pills?|caps?|capsules?))\b/
const TABLET_WORD = /\b(?:tablets?|tabs?|pills?|caps?|capsules?)\b/

const num = (s: string) => Number(s.replace(",", "."))

function toMl(value: number, unit: string): number {
  switch (unit) {
    case "l": case "litre": case "litres": case "liter": case "liters": return Math.round(value * 1000)
    case "cl": return Math.round(value * 10)
    case "dl": return Math.round(value * 100)
    default: return Math.round(value)
  }
}

function toMg(value: number, unit: string): number {
  if (unit === "g") return value * 1000
  if (unit === "mcg" || unit === "µg" || unit === "ug") return value / 1000
  return value
}

/** Diacritics, emoticons and approximation marks are not information. */
function normalise(message: string): string {
  return fold(message)
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/(?:^|\s)(?::-?[)(dp]|;-?\)|xd)(?=\s|$)/g, " ")
    .replace(/\((.*?)\)/g, " $1 ")
    .replace(/(?:about|approx\.?|around|roughly|~|\+-|\+\/-|±)\s*(?=\d)/g, "")
    // Said before the split, so "with ice" is a modifier and not a second item,
    // and "time - now" is one word, not a dash and a stray.
    .replace(/\b(?:with|on|over) ice\b/g, "iced")
    .replace(/\btime\s*[-:]?\s*(?:is\s+)?now\b/g, "now")
    .replace(/\s+/g, " ")
    .trim()
}

/** One edit apart, for a name the user has logged many times before ("Elica" for Elicea). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function findSubstance(candidate: string, known: string[]): string | null {
  const key = matchKey(candidate)
  if (!key || key.length < 3) return null
  const exact = known.find(k => matchKey(k) === key)
  if (exact) return exact
  if (key.length < 5) return null
  const near = known.filter(k => withinOneEdit(matchKey(k), key))
  return near.length === 1 ? near[0] : null
}

interface Timing { minutesAgo: number; clock?: boolean }

/** The one time in the item, resolved against the user's clock. Undefined when none was said; null when it cannot be honoured. */
function takeTime(text: string, localMinutes: number): { rest: string; timing?: Timing | null } {
  let rest = text
  const clock = CLOCK.exec(rest)
  if (clock) {
    const h = Number(clock[1]), m = Number(clock[2])
    if (h > 23 || m > 59) return { rest, timing: null }
    let ago = localMinutes - (h * 60 + m)
    // Five minutes of clock skew is "now"; further ahead is not today, and
    // whether they meant yesterday evening is the model's question to ask.
    if (ago < -5) return { rest, timing: null }
    ago = Math.max(0, ago)
    rest = rest.replace(CLOCK, " ")
    return { rest, timing: { minutesAgo: ago, clock: true } }
  }
  const ago = AGO.exec(rest)
  if (ago) {
    let minutes: number
    if (ago[1] !== undefined) minutes = Number(ago[1]) * 60 + Number(ago[2] ?? 0)
    else if (ago[3] !== undefined) minutes = Number(ago[3])
    else minutes = /half/.test(ago[0]) ? 30 : 60
    if (minutes > MAX_MINUTES_AGO) return { rest, timing: null }
    rest = rest.replace(AGO, " ")
    return { rest, timing: { minutesAgo: minutes } }
  }
  if (NOW.test(rest)) return { rest: rest.replace(NOW, " "), timing: { minutesAgo: 0 } }
  return { rest }
}

function parseItem(raw: string, ctx: QuickLogContext, previous: QuickItem | null): QuickItem | null {
  let text = raw.replace(/^(?:log|add|record|track|note)\s+(?:me\s+)?/, " ")

  const timed = takeTime(text, ctx.localMinutes)
  if (timed.timing === null) return null
  text = timed.rest
  const minutesAgo = timed.timing?.minutesAgo ?? 0

  let amountMl: number | null = null
  const vol = VOLUME.exec(text)
  if (vol) {
    amountMl = toMl(num(vol[1]), vol[2])
    text = text.replace(VOLUME, " ")
  }

  let abv: number | null = null
  const abvM = ABV.exec(text)
  if (abvM) {
    abv = num(abvM[1])
    if (abv <= 0 || abv > 80) return null
    text = text.replace(ABV, " ")
  }

  let plato: number | null = null
  const platoM = PLATO.exec(text)
  if (platoM) {
    plato = Number(platoM[1])
    text = text.replace(PLATO, " ")
  }

  const iced = ICE.test(text)
  text = text.replace(ICE, " ")

  let mg: number | null = null
  const mgM = MG.exec(text)
  if (mgM) {
    mg = toMg(num(mgM[1]), mgM[2])
    text = text.replace(MG, " ")
  }

  let tablets: number | null = null
  const tabM = TABLETS.exec(text)
  if (tabM) {
    tablets = tabM[1] === "half" ? 0.5 : tabM[1] === "quarter" ? 0.25 : num(tabM[2])
    text = text.replace(TABLETS, " ").replace(TABLET_WORD, " ")
  }

  const name = text.replace(FILLER, " ").replace(/\s+/g, " ").trim()

  // "log 250ml water 9:00 and 11:00" — a bare time is the last thing again, then.
  if (!name && amountMl == null && abv == null && mg == null && tablets == null && timed.timing?.clock && previous) {
    return { ...previous, minutesAgo }
  }
  if (!name) return null

  const drink = DRINKS.find(d => d.re.test(name))
  if (drink) {
    if (mg != null || tablets != null) return null
    const ml = amountMl ?? drink.defaultMl ?? null
    if (ml == null || ml < 1 || ml > 5000) return null
    // Sane on its face: a beer in degrees Plato carries its strength either way.
    if (abv != null && !["beer", "wine", "spirits"].includes(drink.type)) return null
    if (plato != null && drink.type !== "beer") return null
    let label = drink.label
    if (drink.type === "wine" && /^(white|red|rose|sparkling)/.test(name)) {
      label = name.charAt(0).toUpperCase() + name.slice(1)
    }
    if (label && iced) label += " with ice"
    if (label && plato != null) label += ` ${plato}°`
    if (label && abv != null) label += plato != null ? ` (${abv}%)` : ` ${abv}%`
    return { kind: "drink", type: drink.type, amountMl: ml, note: label, abv, minutesAgo }
  }

  if (amountMl != null || abv != null || plato != null || iced) return null
  const substance = findSubstance(name, ctx.knownSubstances)
  if (!substance) return null
  if (mg != null && (mg <= 0 || mg > 5000)) return null
  if (tablets != null && (tablets <= 0 || tablets > 4)) return null
  const dose = mg != null ? { amount: Math.round(mg * 1000) / 1000, unit: "mg" as const }
    : tablets != null ? { amount: tablets, unit: "tablet" as const }
    : null
  return { kind: "dose", name: substance, dose, minutesAgo }
}

/**
 * The saved place named anywhere in the message — "at kaviaren vtak log …",
 * "… still at Vtak". Returns the place as stored, the message without the
 * phrase, or `null` for a place we do not know (which is the model's to ask
 * about, not ours to drop).
 */
function takePlace(text: string, places: string[]): { rest: string; place: string | null } | null {
  const m = /\b(?:still |currently |now )?at\s+(?!\d)([a-z][a-z' ]*?)(?=\s*(?:[,;.:()\-–—]|\band\b|\balso\b|\blog\b|\badd\b|\bhad\b|\bhaving\b|$))/.exec(text)
  if (!m) return { rest: text, place: null }
  const said = m[1].trim()
  if (!said) return null
  const hit = places.filter(p => {
    const f = fold(p)
    return f === said || f.includes(said) || said.includes(f)
  })
  if (hit.length !== 1) return null
  return { rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim(), place: hit[0] }
}

/**
 * A cheap gate, so an ordinary chat message costs no database work: does this
 * even have the shape of a log line? Pure string work, no context needed.
 */
export function looksLikeQuickLog(message: string): boolean {
  if (!message || message.length > 300) return false
  if (/\?/.test(message)) return false
  const text = normalise(message)
  if (!text) return false
  const withoutPlace = text.replace(/\b(?:still |currently |now )?at\s+[a-z][a-z' ]*/, " ").trim()
  return VERB.test(text.replace(LEAD, "").trim()) || VERB.test(withoutPlace.replace(LEAD, "").trim())
}

/**
 * Read a chat message as a list of things to log. Null means "not ours" —
 * hand it to the model — and is the answer for anything the grammar is not
 * certain of.
 */
export function parseQuickLog(message: string, ctx: QuickLogContext): QuickLog | null {
  if (!message || message.length > 300) return null
  if (/\?/.test(message)) return null
  let text = normalise(message)
  if (!text) return null

  const placed = takePlace(text, ctx.places)
  if (!placed) return null
  text = placed.rest

  text = text.replace(LEAD, "").trim()
  if (!VERB.test(text)) return null
  text = text.replace(VERB, "").trim()
  if (!text) return null

  const parts = text.split(SEPARATOR).map(p => p.trim()).filter(Boolean)
  if (parts.length === 0 || parts.length > MAX_ITEMS) return null

  const items: QuickItem[] = []
  for (const part of parts) {
    // "log me 500ml of beer, time - now": "now" is what a log is anyway.
    if (/^(?:time\s*[-:]?\s*)?(?:just\s+)?now$/.test(part)) continue
    // A verb repeated mid-message ("… also log 500ml water at 13:00") is fine.
    const item = parseItem(part, ctx, items[items.length - 1] ?? null)
    if (!item) return null
    items.push(item)
  }
  return { items, place: placed.place }
}

// ── Saying it back ──────────────────────────────────────────────────────────

function ml(n: number): string {
  return n >= 1000 ? `${Math.round(n / 10) / 100}L` : `${n}ml`
}

function when(minutesAgo: number, localMinutes: number): string {
  if (minutesAgo <= 0) return ""
  if (minutesAgo < 60) return ` ${minutesAgo} min ago`
  const at = localMinutes - minutesAgo
  if (at >= 0) return ` at ${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`
  const h = Math.floor(minutesAgo / 60), m = minutesAgo % 60
  return ` ${h}h${m ? ` ${m}m` : ""} ago`
}

export function describeItem(item: QuickItem, localMinutes: number, caffeineMg?: number | null): string {
  if (item.kind === "drink") {
    const what = item.note ? `${ml(item.amountMl)} ${item.note.charAt(0).toLowerCase()}${item.note.slice(1)}` : `${ml(item.amountMl)} water`
    const caf = caffeineMg ? ` (≈${caffeineMg}mg caffeine)` : ""
    return `${what}${caf}${when(item.minutesAgo, localMinutes)}`
  }
  const amount = item.dose
    ? item.dose.unit === "mg" ? ` ${Math.round(item.dose.amount * 100) / 100}mg` : ` ${item.dose.amount === 0.5 ? "½" : item.dose.amount === 0.25 ? "¼" : item.dose.amount} tablet${item.dose.amount > 1 ? "s" : ""}`
    : ""
  return `${item.name}${amount}${when(item.minutesAgo, localMinutes)}`
}

/** "a, b and c" */
export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}
