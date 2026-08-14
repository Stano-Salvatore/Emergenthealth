// What counts as fluid, and how much of it.
//
// Every hydration total in the app filtered `type: "water"`, so a drink logged
// as coffee, tea or mate contributed nothing. Drink a litre of yerba mate and
// Emergy would still shout PLEASE DRINK WATER I AM BEGGING YOU at five o'clock.
//
// That isn't a rounding error, it's the wrong model. A cup of coffee is roughly
// a cup of water with caffeine dissolved in it, and at habitual doses the mild
// diuretic effect doesn't come close to offsetting the volume — caffeinated
// drinks are net hydrating. Counting them as zero understated real intake for
// anyone whose day runs on coffee, which is most people who would use this app.
//
// Alcohol genuinely does work the other way, so it's discounted rather than
// counted or ignored. The factors below are deliberately coarse: they say
// "beer is mostly water, spirits are not" and nothing more precise, because
// nothing more precise would be honest at the level of one logged drink.

/** Fraction of a drink's volume that counts toward fluid intake. */
export const HYDRATION_FACTOR: Record<string, number> = {
  water: 1,
  sparkling: 1,
  tea: 1,
  matcha: 1,
  mate: 1,
  coffee: 1,
  juice: 1,
  soda: 1,
  milk: 1,
  other: 1,

  // Net-negative territory. Beer is mostly water and still counts for most of
  // its volume; spirits are written off entirely rather than credited.
  beer: 0.8,
  wine: 0.4,
  alcohol: 0.2,
  spirits: 0,
}

/** Types that contribute nothing — kept explicit so the list is auditable. */
export const NON_HYDRATING = new Set(["spirits"])

/**
 * Fluid contributed by one logged drink. An unknown type counts fully: a drink
 * the app doesn't recognise is still a drink, and silently scoring it zero is
 * the bug this module exists to fix.
 */
export function hydrationMl(type: string | null | undefined, amountMl: number): number {
  if (!Number.isFinite(amountMl) || amountMl <= 0) return 0
  const factor = HYDRATION_FACTOR[(type ?? "").toLowerCase()] ?? 1
  return Math.round(amountMl * factor)
}

export interface DrinkLike {
  type: string | null
  amountMl: number
}

/** Total fluid across logged drinks. */
export function sumHydration(logs: DrinkLike[]): number {
  return logs.reduce((total, l) => total + hydrationMl(l.type, l.amountMl), 0)
}

/**
 * Fluid split into plain water and everything else, so a total that now
 * includes coffee can still show where it came from rather than quietly
 * making the goal easier to hit.
 */
export function hydrationBreakdown(logs: DrinkLike[]): { total: number; water: number; other: number } {
  let water = 0
  let other = 0
  for (const l of logs) {
    const ml = hydrationMl(l.type, l.amountMl)
    if ((l.type ?? "").toLowerCase() === "water") water += ml
    else other += ml
  }
  return { total: water + other, water, other }
}

/** SQL fragment listing the types worth selecting — excludes the zero-factor ones. */
export const HYDRATING_TYPES = Object.keys(HYDRATION_FACTOR).filter(t => !NON_HYDRATING.has(t))
