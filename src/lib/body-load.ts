// "In my body" — what's still circulating right now, across every substance
// the app knows about: caffeine, alcohol, and any med or supplement with a
// known half-life.
//
// The three obey different pharmacokinetics, and pretending otherwise would
// make the numbers pretty and wrong:
//
//  - Caffeine and most drugs clear by FIRST-ORDER kinetics — a constant
//    fraction per unit time, so they decay exponentially and technically
//    never hit zero.
//  - Alcohol is the odd one out: the enzyme that clears it saturates almost
//    immediately, so it leaves at a near-constant NUMBER OF GRAMS per hour
//    (zero-order) and has a real finishing time.
//
// Everything here is a population-average model applied to one person. It's
// for planning sleep and understanding patterns — explicitly not a
// breathalyzer, and never a basis for deciding whether to drive.

export type LoadKind = "caffeine" | "alcohol" | "med"

export interface ActiveSubstance {
  kind: LoadKind
  name: string
  emoji: string
  /** Remaining amount, already rounded for display. */
  amount: number
  unit: "mg" | "g" | "%"
  /** Share of the original dose still present, 0-1 (first-order substances). */
  fraction?: number
  takenAt: string        // ISO
  /** When it drops under a "doesn't matter any more" threshold. */
  clearsAt: string | null
  detail?: string
  /**
   * The log row this card was computed from, when it came from exactly one —
   * a med dose does, a caffeine total summed from three coffees does not.
   * Present only for rows the user is allowed to change: an Oura-sourced tag
   * would come straight back on the next sync, so offering to edit it would
   * be a lie.
   */
  sourceId?: string
  /** How much was recorded, when it was recorded at all. */
  doseLabel?: string | null
}

// ── Alcohol ──────────────────────────────────────────────────────────────────

const ETHANOL_DENSITY = 0.789 // g/ml

/** Typical ABV by drink type when the log doesn't say otherwise. */
const ABV: Record<string, number> = {
  beer: 0.05,
  wine: 0.12,
  spirits: 0.40,
  alcohol: 0.08, // cocktails and anything unlabelled
}

/** Grams of ethanol in a logged drink. Returns 0 for non-alcoholic types. */
export function ethanolGrams(type: string, amountMl: number, note?: string): number {
  const abvFromNote = note?.match(/(\d{1,2}(?:[.,]\d)?)\s*%/)
  const abv = abvFromNote
    ? Math.min(0.6, parseFloat(abvFromNote[1].replace(",", ".")) / 100)
    : ABV[type]
  if (!abv || !(amountMl > 0)) return 0
  return amountMl * abv * ETHANOL_DENSITY
}

/**
 * Grams of ethanol cleared per hour. Widmark: the body eliminates about
 * 0.15 g/L of blood-water per hour, and the distribution volume scales with
 * body mass and sex.
 */
export function alcoholClearanceGPerHour(weightKg?: number | null, sex?: string | null): number {
  const r = sex === "male" ? 0.68 : sex === "female" ? 0.55 : 0.62
  const mass = weightKg && weightKg >= 30 && weightKg <= 250 ? weightKg : 75
  return 0.15 * r * mass
}

/**
 * Alcohol still unprocessed, given every drink of the session. Zero-order:
 * total consumed minus a flat rate per hour since the FIRST drink, floored at
 * zero — drinking faster than you clear stacks up, which is the point.
 */
export function alcoholRemainingG(
  drinks: { grams: number; at: Date }[],
  now: Date,
  clearanceGPerHour: number,
): { remainingG: number; clearsAt: Date | null; firstAt: Date | null } {
  const relevant = drinks.filter(d => d.at <= now)
  if (relevant.length === 0) return { remainingG: 0, clearsAt: null, firstAt: null }

  const sorted = [...relevant].sort((a, b) => a.at.getTime() - b.at.getTime())
  // Walk the timeline so elimination only runs while there's something to
  // eliminate — a drink at 18:00 and another at 23:00 aren't one long session.
  let load = 0
  let cursor = sorted[0].at.getTime()
  for (const d of sorted) {
    const hours = (d.at.getTime() - cursor) / 3_600_000
    load = Math.max(0, load - hours * clearanceGPerHour)
    load += d.grams
    cursor = d.at.getTime()
  }
  const hoursSinceLast = (now.getTime() - cursor) / 3_600_000
  const remainingG = Math.max(0, load - hoursSinceLast * clearanceGPerHour)
  const clearsAt = remainingG > 0
    ? new Date(now.getTime() + (remainingG / clearanceGPerHour) * 3_600_000)
    : null
  return { remainingG, clearsAt, firstAt: sorted[0].at }
}

/** Standard drinks (10 g ethanol each, EU convention). */
export const standardDrinks = (grams: number) => Math.round((grams / 10) * 10) / 10

// ── First-order substances (caffeine, most meds) ─────────────────────────────

/** Hours until `amount` decays below `floor` at a given half-life. */
export function hoursUntilBelow(amount: number, floor: number, halfLifeH: number): number | null {
  if (amount <= floor) return 0
  if (!(halfLifeH > 0)) return null
  return halfLifeH * Math.log2(amount / floor)
}

export function decayFraction(hoursSince: number, halfLifeH: number): number {
  if (hoursSince < 0 || !(halfLifeH > 0)) return 1
  return Math.pow(0.5, hoursSince / halfLifeH)
}

/** Substances below this share of their dose are dropped from the list. */
export const MED_FLOOR_FRACTION = 0.05
/** Caffeine under this many mg isn't worth mentioning. */
export const CAFFEINE_FLOOR_MG = 10
