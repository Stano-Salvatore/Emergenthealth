// "Should I be eating more of something?"
//
// The app already extracts micronutrients from every logged meal and then does
// nothing with them: each meal carries its own `dailyPct`, guessed per meal,
// never summed across a day and never compared to anything. So you could see
// that lunch had some magnesium in it and still have no idea whether your week
// was short of it.
//
// This sums them against the EU Nutrient Reference Values and reports where
// intake runs persistently low. Three things it deliberately is not:
//
//   It is not a diagnosis. Food logs cannot establish a deficiency — blood
//   tests do. Where a lab result exists for a low nutrient it's shown beside
//   the intake figure, because "my logs look low AND my last panel was in
//   range" and "...AND nobody has ever measured it" lead to different
//   conversations with a doctor.
//
//   It is not a recommendation. It names foods rich in a nutrient, which is a
//   fact. It never says to take a supplement or names a dose — that's
//   prescriptive, and supplements interact with medication.
//
//   It is not willing to report on partial logging. If you log lunch and skip
//   dinner, every nutrient looks deficient, and a page full of invented
//   shortfalls is worse than no page. The coverage gates below refuse rather
//   than guess.

/**
 * EU Nutrient Reference Values for adults — Regulation (EU) No 1169/2011,
 * Annex XIII. These are labelling reference values, not personalised targets:
 * they don't vary with age, sex, pregnancy, body mass or activity, and real
 * requirements do. They're the right basis for "is this roughly enough" and
 * the wrong basis for anything more specific.
 */
export const NRV: Record<string, { amount: number; unit: "mg" | "ug" }> = {
  "Vitamin A": { amount: 800, unit: "ug" },
  "Vitamin D": { amount: 5, unit: "ug" },
  "Vitamin E": { amount: 12, unit: "mg" },
  "Vitamin K": { amount: 75, unit: "ug" },
  "Vitamin C": { amount: 80, unit: "mg" },
  "Thiamin": { amount: 1.1, unit: "mg" },
  "Riboflavin": { amount: 1.4, unit: "mg" },
  "Niacin": { amount: 16, unit: "mg" },
  "Vitamin B6": { amount: 1.4, unit: "mg" },
  "Folate": { amount: 200, unit: "ug" },
  "Vitamin B12": { amount: 2.5, unit: "ug" },
  "Biotin": { amount: 50, unit: "ug" },
  "Pantothenic acid": { amount: 6, unit: "mg" },
  "Potassium": { amount: 2000, unit: "mg" },
  "Calcium": { amount: 800, unit: "mg" },
  "Phosphorus": { amount: 700, unit: "mg" },
  "Magnesium": { amount: 375, unit: "mg" },
  "Iron": { amount: 14, unit: "mg" },
  "Zinc": { amount: 10, unit: "mg" },
  "Copper": { amount: 1, unit: "mg" },
  "Manganese": { amount: 2, unit: "mg" },
  "Selenium": { amount: 55, unit: "ug" },
  "Chromium": { amount: 40, unit: "ug" },
  "Molybdenum": { amount: 50, unit: "ug" },
  "Iodine": { amount: 150, unit: "ug" },
}

/** Foods genuinely rich in each — a fact about food, not advice about you. */
export const FOOD_SOURCES: Record<string, string> = {
  "Vitamin A": "liver, sweet potato, carrots, spinach",
  "Vitamin D": "oily fish, egg yolk, fortified dairy — and sunlight, which no food log can see",
  "Vitamin E": "sunflower seeds, almonds, olive oil",
  "Vitamin K": "kale, spinach, broccoli, fermented foods",
  "Vitamin C": "peppers, citrus, blackcurrants, broccoli",
  "Thiamin": "pork, sunflower seeds, whole grains, legumes",
  "Riboflavin": "dairy, eggs, almonds, mushrooms",
  "Niacin": "chicken, tuna, peanuts, whole grains",
  "Vitamin B6": "chicken, fish, potatoes, bananas, chickpeas",
  "Folate": "leafy greens, legumes, liver, beetroot",
  "Vitamin B12": "meat, fish, eggs, dairy — plant foods carry essentially none",
  "Biotin": "egg yolk, liver, nuts, seeds",
  "Pantothenic acid": "meat, eggs, avocado, mushrooms",
  "Potassium": "potatoes, beans, bananas, tomatoes, yoghurt",
  "Calcium": "dairy, sardines with bones, tofu, kale",
  "Phosphorus": "meat, fish, dairy, nuts, whole grains",
  "Magnesium": "pumpkin seeds, dark chocolate, spinach, almonds, black beans",
  "Iron": "red meat, liver, lentils, spinach — plant iron absorbs better with vitamin C alongside",
  "Zinc": "oysters, beef, pumpkin seeds, lentils",
  "Copper": "liver, oysters, dark chocolate, cashews",
  "Manganese": "whole grains, nuts, tea, leafy greens",
  "Selenium": "brazil nuts, tuna, eggs — a couple of brazil nuts covers a day",
  "Chromium": "broccoli, whole grains, meat",
  "Molybdenum": "legumes, grains, nuts",
  "Iodine": "seafood, dairy, iodised salt, seaweed",
}

/**
 * Lab markers that measure a nutrient's status directly. Only nutrients where
 * a blood test genuinely reflects intake are listed — there's no useful serum
 * measure of magnesium status, for instance, so it isn't here.
 */
export const LAB_MARKER_FOR: Record<string, string> = {
  "Vitamin D": "Vitamin D",
  "Vitamin B12": "Vitamin B12",
  "Folate": "Folate",
  "Iron": "Ferritin",
  "Calcium": "Calcium",
  "Zinc": "Zinc",
}

/** Common aliases → the canonical name used above. */
const ALIASES: Record<string, string> = {
  "vitamin b1": "Thiamin", "thiamine": "Thiamin",
  "vitamin b2": "Riboflavin",
  "vitamin b3": "Niacin", "niacinamide": "Niacin",
  "vitamin b5": "Pantothenic acid",
  "pyridoxine": "Vitamin B6",
  "vitamin b9": "Folate", "folic acid": "Folate",
  "cobalamin": "Vitamin B12", "b12": "Vitamin B12",
  "vitamin b7": "Biotin",
  "ascorbic acid": "Vitamin C", "vitamin c": "Vitamin C",
  "retinol": "Vitamin A",
  "cholecalciferol": "Vitamin D", "vitamin d3": "Vitamin D",
  "tocopherol": "Vitamin E",
  "phylloquinone": "Vitamin K",
}

export function normalizeNutrient(raw: string): string | null {
  const n = (raw ?? "").trim()
  if (!n) return null
  const lower = n.toLowerCase()
  if (ALIASES[lower]) return ALIASES[lower]
  for (const key of Object.keys(NRV)) {
    if (key.toLowerCase() === lower) return key
  }
  return null
}

/**
 * Convert an amount to micrograms. IU is accepted only where the conversion is
 * substance-specific and known — an IU is a unit of biological activity, not
 * of mass, so "400 IU" means different masses for different vitamins and
 * nothing at all for a mineral.
 */
export function toMicrograms(amount: number, unit: string, nutrient: string): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null
  const u = (unit ?? "").trim().toLowerCase().replace(/µ|μ/g, "u")

  if (u === "g") return amount * 1_000_000
  if (u === "mg") return amount * 1000
  if (u === "ug" || u === "mcg") return amount
  if (u === "iu") {
    if (nutrient === "Vitamin D") return amount * 0.025   // 1 IU = 0.025 µg
    if (nutrient === "Vitamin E") return amount * 0.67 * 1000 // 1 IU ≈ 0.67 mg
    if (nutrient === "Vitamin A") return amount * 0.3     // 1 IU ≈ 0.3 µg RAE (retinol)
    return null
  }
  return null
}

function nrvInMicrograms(nutrient: string): number | null {
  const ref = NRV[nutrient]
  if (!ref) return null
  return ref.unit === "mg" ? ref.amount * 1000 : ref.amount
}

export interface LoggedMicro {
  /** YYYY-MM-DD */
  day: string
  name: string
  amount: number
  unit: string
}

export interface DayCalories {
  day: string
  calories: number
}

export interface NutrientGap {
  nutrient: string
  /** Average per day across the whole window, in the NRV's own unit. */
  avgPerDay: number
  unit: "mg" | "ug"
  /** Average as a percentage of the reference value. */
  pctOfNrv: number
  /** Days in the window that carried any reading for this nutrient. */
  daysSeen: number
  foods: string
  /** The lab marker that would actually measure this, if one exists. */
  labMarker: string | null
}

export type CoverageVerdict =
  | { ok: true; daysLogged: number; windowDays: number; avgCalories: number }
  | { ok: false; reason: string; daysLogged: number; windowDays: number; avgCalories: number }

/** Days of the window that must carry a food log before gaps mean anything. */
const MIN_DAY_COVERAGE = 0.6
/**
 * Logged calories below this suggest meals are being missed rather than that
 * the person barely eats — day coverage alone can't tell those apart, because
 * logging one lunch a day scores full coverage on a third of the food.
 */
const MIN_AVG_CALORIES = 1200
/** Below the NRV by enough to be worth a sentence. */
const LOW_THRESHOLD_PCT = 70
/** A nutrient needs this many readings before its average means anything. */
const MIN_DAYS_SEEN = 5

/**
 * Is this food log complete enough to draw conclusions from? Partial logging
 * makes every nutrient look deficient, and an alarming false shortfall is a
 * worse outcome than an empty page.
 */
export function assessCoverage(dayCalories: DayCalories[], windowDays: number): CoverageVerdict {
  const logged = dayCalories.filter(d => d.calories > 0)
  const daysLogged = logged.length
  const avgCalories = daysLogged > 0
    ? Math.round(logged.reduce((s, d) => s + d.calories, 0) / daysLogged)
    : 0
  const base = { daysLogged, windowDays, avgCalories }

  if (daysLogged / Math.max(1, windowDays) < MIN_DAY_COVERAGE) {
    return {
      ok: false,
      reason: `Food logged on ${daysLogged} of the last ${windowDays} days. Below about ${Math.round(MIN_DAY_COVERAGE * 100)}% there isn't enough to tell a real shortfall from a missed meal.`,
      ...base,
    }
  }
  if (avgCalories < MIN_AVG_CALORIES) {
    return {
      ok: false,
      reason: `Logged days average ${avgCalories} kcal, which suggests meals are being missed rather than eaten. Nutrient totals from a partial log would read low whatever you actually ate.`,
      ...base,
    }
  }
  return { ok: true, ...base }
}

/**
 * Nutrients running below the reference value, worst first. Averages are taken
 * over the whole window rather than over days-seen: a nutrient recorded once at
 * full NRV is not a day's intake repeated, it's one day and the rest at zero.
 */
export function nutrientGaps(micros: LoggedMicro[], windowDays: number): NutrientGap[] {
  const totals = new Map<string, { ug: number; days: Set<string> }>()

  for (const m of micros) {
    const nutrient = normalizeNutrient(m.name)
    if (!nutrient) continue
    const ug = toMicrograms(m.amount, m.unit, nutrient)
    if (ug == null) continue
    const entry = totals.get(nutrient) ?? { ug: 0, days: new Set<string>() }
    entry.ug += ug
    entry.days.add(m.day)
    totals.set(nutrient, entry)
  }

  const gaps: NutrientGap[] = []
  for (const [nutrient, { ug, days }] of totals) {
    const refUg = nrvInMicrograms(nutrient)
    const ref = NRV[nutrient]
    if (refUg == null || !ref) continue
    if (days.size < MIN_DAYS_SEEN) continue

    const avgUgPerDay = ug / Math.max(1, windowDays)
    const pct = Math.round((avgUgPerDay / refUg) * 100)
    if (pct >= LOW_THRESHOLD_PCT) continue

    const avgInRefUnit = ref.unit === "mg" ? avgUgPerDay / 1000 : avgUgPerDay
    gaps.push({
      nutrient,
      avgPerDay: Math.round(avgInRefUnit * 100) / 100,
      unit: ref.unit,
      pctOfNrv: pct,
      daysSeen: days.size,
      foods: FOOD_SOURCES[nutrient] ?? "",
      labMarker: LAB_MARKER_FOR[nutrient] ?? null,
    })
  }

  return gaps.sort((a, b) => a.pctOfNrv - b.pctOfNrv)
}

export const NUTRIENT_CAVEAT =
  "Counted from what you logged, against EU labelling reference values — which don't vary with age, sex or activity, and your needs do. Micronutrients read from a meal are the roughest numbers here. Food logs can't diagnose a deficiency; only a blood test does that."
