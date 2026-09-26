// Calories in what the user drinks, priced from what a drink actually is.
//
// Alcoholic drinks are two energy sources in one glass: the ethanol itself
// (7 kcal per gram — between carbs and fat, and the part everyone forgets)
// and the residual sugar or malt around it. Pricing them as one flat
// kcal/100ml number would make a 2% radler and an 8% IPA cost the same,
// so the ethanol part rides on `ethanolGrams`, which already reads a
// stated ABV out of the note. The carb remainder is the only flat guess.
//
// Soft drinks are a single flat number, and the zero rows are deliberate:
// black coffee and tea are ~2 kcal a cup, which is rounding noise dressed
// up as tracking.

import { ethanolGrams, isAlcohol } from "./body-load"

export const ETHANOL_KCAL_PER_G = 7

/** kcal per 100ml from everything BUT the ethanol (residual sugar, malt). */
const CARB_KCAL_PER_100ML: Record<string, number> = {
  beer: 15,
  wine: 10,
  spirits: 0,
  alcohol: 12, // cocktails and anything unlabelled — mixers carry sugar
}

/** Whole-drink kcal per 100ml for caloric soft drinks. */
const PLAIN_KCAL_PER_100ML: Record<string, number> = {
  juice: 45,
  soda: 42,
  milk: 60,
}

export function drinkCalories(type: string, amountMl: number, note?: string): number {
  const t = (type ?? "").toLowerCase()
  if (!(amountMl > 0)) return 0
  if (isAlcohol(t)) {
    const carb = (CARB_KCAL_PER_100ML[t] ?? 0) * (amountMl / 100)
    return Math.round(ethanolGrams(t, amountMl, note) * ETHANOL_KCAL_PER_G + carb)
  }
  return Math.round((PLAIN_KCAL_PER_100ML[t] ?? 0) * (amountMl / 100))
}

/** A day of intake rows, summed. Unknown types and empty rows cost nothing. */
export function drinkCaloriesTotal(
  rows: { type: string; amountMl: number; note?: string | null }[],
): number {
  return rows.reduce((s, r) => s + drinkCalories(r.type, r.amountMl, r.note ?? undefined), 0)
}
