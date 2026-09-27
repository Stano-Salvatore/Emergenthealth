import { fold } from "@/lib/supplement-normalize"

// How much was taken, as a number the app can compare — not a word buried in
// a name.
//
// Two units, deliberately kept apart:
//   "mg"     — an absolute amount. 12.5mg is half of 25mg, and the app may say so.
//   "tablet" — a share of a tablet whose strength nobody told us. Half a tablet
//              is half of a whole one and NOTHING else: it cannot be converted
//              to milligrams without the strength, and pretending otherwise
//              would put an invented number into a medical record.
//
// A dose written either way is parsed off the label at log time, so "Atarax -
// half" records 0.5 tablet and "Atarax 12.5 mg" records 12.5 mg, while the
// name of the substance stays just the substance in both cases.

export type DoseUnit = "mg" | "tablet"

export type ParsedDose = {
  amount: number
  unit: DoseUnit
}

const WORD_FRACTIONS: [RegExp, number][] = [
  [/\b(half|halve|pol|polka|polovica|polovicu)\b/i, 0.5],
  [/\b(quarter|[sš]tvrtina|[sš]tvr[tť])\b/i, 0.25],
  [/\b(third|tretina)\b/i, 1 / 3],
  [/\b(double|dvojit[aáu])\b/i, 2],
  [/\b(triple)\b/i, 3],
]

const CHAR_FRACTIONS: [string, number][] = [
  ["½", 0.5], ["¼", 0.25], ["¾", 0.75], ["⅓", 1 / 3], ["⅔", 2 / 3],
]

/** Milligrams, when the label states an absolute amount. */
const MG = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|ug|g)\b/i

/** Tablet counts: "2 tablets", "1 tbl", "x2", "2x". */
const TABLET_COUNT = /(\d+(?:[.,]\d+)?)\s*(?:tablet\w*|tbl|tabs?|caps?|pills?)\b/i
const MULTIPLIER = /\b(?:x\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*x)\b/i

/** How often, not how many: "2x daily" is a schedule, never two tablets. */
const FREQUENCY = /\b(?:\d+\s*x|x\s*\d+)\s*(?:daily|a day|per day|\/\s*day|a week|weekly|denne|za\s*den|tyzdenne)\b/gi

/** When, not how much: "½ hour before bed", "1/2h", "half an hour". */
const TIME_SHARE = /(?:\d\s*\/\s*\d|[½¼¾⅓⅔]|\b(?:half|quarter)(?:\s+(?:of\s+)?an)?)\s*(?:hours?|hrs?|h|min\w*|hod\w*)\b/gi

const num = (s: string) => Number(s.replace(",", "."))

/**
 * Pull a dose out of a free-text label. Returns null when the label says
 * nothing about quantity — which is not the same as "one tablet", and is left
 * as unknown rather than assumed.
 */
export function parseDose(rawLabel: string): ParsedDose | null {
  if (!rawLabel) return null
  const label = rawLabel.trim().replace(FREQUENCY, " ").replace(TIME_SHARE, " ")

  const share = tabletShare(label)
  const mg = label.match(MG)
  if (mg) {
    const value = num(mg[1])
    if (Number.isFinite(value) && value > 0) {
      // "Atarax 25mg half" — 25 is the tablet or the dose, and the label
      // cannot say which. Unknown beats a doubled dose in a medical record.
      if (share && share.amount !== 1) return null
      const unit = mg[2].toLowerCase()
      const amount =
        unit === "g" ? value * 1000 :
        unit === "mcg" || unit === "µg" || unit === "ug" ? value / 1000 :
        value
      return { amount: Math.round(amount * 1000) / 1000, unit: "mg" }
    }
  }
  return share
}

/**
 * What the dose box on a logged entry means. A number with its unit says it
 * all; a bare number keeps the unit the entry already has, and on an entry
 * with none it cannot tell 400 mg from 400 tablets and asks.
 */
export function parseDoseEdit(
  raw: string,
  existingUnit: string | null | undefined,
): { dose: ParsedDose | null } | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { dose: null }
  if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
    const value = num(trimmed)
    if (!(value > 0)) return { error: "A dose needs a positive number." }
    if (existingUnit === "mg" || existingUnit === "tablet") return { dose: { amount: value, unit: existingUnit } }
    return { error: `Say which: ${trimmed}mg, or ${trimmed} tablet${value === 1 ? "" : "s"}.` }
  }
  const dose = parseDose(trimmed)
  return dose ? { dose } : { error: "A dose needs a positive number, like 12.5mg or ½." }
}

function tabletShare(label: string): ParsedDose | null {
  const tablets = label.match(TABLET_COUNT)
  if (tablets) {
    const value = num(tablets[1])
    if (Number.isFinite(value) && value > 0) return { amount: value, unit: "tablet" }
  }

  for (const [char, value] of CHAR_FRACTIONS) {
    if (label.includes(char)) return { amount: value, unit: "tablet" }
  }

  // "1/2", but not a date like 3/4/2026.
  const slash = label.match(/(?<![\d/])(\d)\s*\/\s*(\d)(?![\d/])/)
  if (slash) {
    const value = num(slash[1]) / num(slash[2])
    if (Number.isFinite(value) && value > 0 && value <= 4) {
      return { amount: Math.round(value * 1000) / 1000, unit: "tablet" }
    }
  }

  const folded = fold(label)
  for (const [re, value] of WORD_FRACTIONS) {
    if (re.test(folded) || re.test(label)) {
      return { amount: Math.round(value * 1000) / 1000, unit: "tablet" }
    }
  }

  const mult = label.match(MULTIPLIER)
  if (mult) {
    const value = num(mult[1] ?? mult[2])
    if (Number.isFinite(value) && value > 0) return { amount: value, unit: "tablet" }
  }

  return null
}

/** How a dose reads in the UI: "12.5mg", "½ tablet", "2 tablets". */
export function formatDose(amount: number | null | undefined, unit: string | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0 || !unit) return null
  if (unit === "mg") {
    const rounded = Math.round(amount * 100) / 100
    return `${rounded}mg`
  }
  const pretty =
    Math.abs(amount - 0.5) < 0.001 ? "½" :
    Math.abs(amount - 0.25) < 0.001 ? "¼" :
    Math.abs(amount - 0.75) < 0.001 ? "¾" :
    Math.abs(amount - 1 / 3) < 0.01 ? "⅓" :
    Math.abs(amount - 2 / 3) < 0.01 ? "⅔" :
    String(Math.round(amount * 100) / 100)
  const plural = amount > 1 ? "tablets" : "tablet"
  return `${pretty} ${plural}`
}

/**
 * Sum doses that can honestly be added together. Milligrams and tablet
 * fractions are different quantities, so a day mixing both reports each
 * separately rather than inventing a total.
 */
export function sumDoses(doses: ParsedDose[]): { mg: number | null; tablets: number | null } {
  let mg = 0, tablets = 0, sawMg = false, sawTab = false
  for (const d of doses) {
    if (d.unit === "mg") { mg += d.amount; sawMg = true }
    else { tablets += d.amount; sawTab = true }
  }
  return {
    mg: sawMg ? Math.round(mg * 1000) / 1000 : null,
    tablets: sawTab ? Math.round(tablets * 1000) / 1000 : null,
  }
}
