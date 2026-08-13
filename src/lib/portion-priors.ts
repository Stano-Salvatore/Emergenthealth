// Portion priors — the scientific guardrail for photo-based portion guessing.
//
// Vision models are good at *identifying* food and bad at *weighing* it: the
// classic failure is "scrambled eggs, 600 g" (a 10-egg plate) when the photo
// shows 3-4 eggs. Two defenses, applied after analysis:
//
//  1. Countable units — when the model reports "4 × large egg", the grams are
//     count × a measured unit weight, not an eyeballed pile. Unit weights
//     below follow USDA FNDDS/FoodData Central portion data (large egg 50 g,
//     bread slice ~32 g, pancake 77 g, ...).
//  2. Serving caps — when a single-serving dish comes back heavier than any
//     plausible single portion (FNDDS 90th-percentile-ish ceilings), clamp to
//     the ceiling and mark the item so the UI/user can correct it.

export interface UnitWeight {
  keywords: string[] // matched against the model's unitName + item name (lowercase)
  grams: number
}

// FNDDS-derived edible weights for common countable units.
// Order matters: first match wins, so more specific entries come first.
const UNIT_WEIGHTS: UnitWeight[] = [
  { keywords: ["egg white"], grams: 33 },
  { keywords: ["egg yolk"], grams: 17 },
  { keywords: ["small egg"], grams: 38 },
  { keywords: ["medium egg"], grams: 44 },
  { keywords: ["egg"], grams: 50 },              // large egg default
  { keywords: ["toast"], grams: 25 },
  { keywords: ["slice", "bread"], grams: 32 },
  { keywords: ["slice", "cheese"], grams: 20 },
  { keywords: ["slice", "ham"], grams: 25 },
  { keywords: ["slice", "salami"], grams: 10 },
  { keywords: ["slice", "bacon"], grams: 12 },
  { keywords: ["rasher"], grams: 12 },
  { keywords: ["slice", "pizza"], grams: 105 },
  { keywords: ["slice", "cake"], grams: 100 },
  { keywords: ["pancake"], grams: 77 },
  { keywords: ["palacink"], grams: 60 },         // palacinka — thin crepe
  { keywords: ["crepe"], grams: 60 },
  { keywords: ["waffle"], grams: 75 },
  { keywords: ["tortilla"], grams: 45 },
  { keywords: ["croissant"], grams: 60 },
  { keywords: ["roll"], grams: 55 },             // rožok/bread roll
  { keywords: ["pierog"], grams: 35 },
  { keywords: ["piroh"], grams: 35 },
  { keywords: ["dumpling"], grams: 35 },
  { keywords: ["meatball"], grams: 30 },
  { keywords: ["sausage"], grams: 75 },
  { keywords: ["frankfurter"], grams: 45 },
  { keywords: ["hot dog"], grams: 45 },
  { keywords: ["chicken wing"], grams: 30 },
  { keywords: ["chicken drumstick"], grams: 70 },
  { keywords: ["chicken thigh"], grams: 90 },
  { keywords: ["banana"], grams: 118 },
  { keywords: ["apple"], grams: 180 },
  { keywords: ["orange"], grams: 130 },
  { keywords: ["mandarin"], grams: 75 },
  { keywords: ["clementine"], grams: 75 },
  { keywords: ["kiwi"], grams: 75 },
  { keywords: ["plum"], grams: 65 },
  { keywords: ["apricot"], grams: 35 },
  { keywords: ["strawberr"], grams: 12 },
  { keywords: ["cherry tomato"], grams: 15 },
  { keywords: ["potato"], grams: 170 },          // medium potato
  { keywords: ["cookie"], grams: 14 },
  { keywords: ["biscuit"], grams: 14 },
  { keywords: ["square", "chocolate"], grams: 6 },
  { keywords: ["date"], grams: 8 },
  { keywords: ["olive"], grams: 4 },
]

export interface ServingCap {
  keywords: string[]
  typicalG: number // FNDDS median-ish single serving
  maxG: number     // generous single-serving ceiling — clamp target
}

// Sanity ceilings for single-serving dishes (per item, not per meal). maxG is
// deliberately generous — the goal is catching 2-3x inflation, not policing
// hearty eaters.
const SERVING_CAPS: ServingCap[] = [
  { keywords: ["scrambled"], typicalG: 220, maxG: 400 },
  { keywords: ["omelet"], typicalG: 200, maxG: 400 },
  { keywords: ["omelette"], typicalG: 200, maxG: 400 },
  { keywords: ["pastry"], typicalG: 110, maxG: 250 },
  { keywords: ["langos"], typicalG: 150, maxG: 300 },
  { keywords: ["langoš"], typicalG: 150, maxG: 300 },
  { keywords: ["donut"], typicalG: 75, maxG: 200 },
  { keywords: ["doughnut"], typicalG: 75, maxG: 200 },
  { keywords: ["sandwich"], typicalG: 250, maxG: 500 },
  { keywords: ["burger"], typicalG: 280, maxG: 550 },
  { keywords: ["pasta"], typicalG: 350, maxG: 650 },
  { keywords: ["spaghetti"], typicalG: 350, maxG: 650 },
  { keywords: ["risotto"], typicalG: 350, maxG: 600 },
  { keywords: ["fried rice"], typicalG: 350, maxG: 600 },
  { keywords: ["soup"], typicalG: 350, maxG: 650 },
  { keywords: ["stew"], typicalG: 350, maxG: 650 },
  { keywords: ["goulash"], typicalG: 350, maxG: 650 },
  { keywords: ["salad"], typicalG: 250, maxG: 500 },
  { keywords: ["steak"], typicalG: 220, maxG: 450 },
  { keywords: ["schnitzel"], typicalG: 200, maxG: 400 },
  { keywords: ["porridge"], typicalG: 300, maxG: 550 },
  { keywords: ["oatmeal"], typicalG: 300, maxG: 550 },
  { keywords: ["yogurt"], typicalG: 180, maxG: 500 },
  { keywords: ["fries"], typicalG: 150, maxG: 350 },
]

function matches(haystack: string, keywords: string[]): boolean {
  return keywords.every(k => haystack.includes(k))
}

/** Edible grams for one unit of a countable item, or null when unknown. */
export function unitWeightFor(unitName: string, itemName: string): number | null {
  const hay = `${unitName} ${itemName}`.toLowerCase()
  for (const u of UNIT_WEIGHTS) {
    if (matches(hay, u.keywords)) return u.grams
  }
  return null
}

export function servingCapFor(itemName: string, searchQuery: string): ServingCap | null {
  const hay = `${itemName} ${searchQuery}`.toLowerCase()
  for (const c of SERVING_CAPS) {
    if (matches(hay, c.keywords)) return c
  }
  return null
}

export interface PortionInput {
  name: string
  searchQuery?: string
  grams?: number
  count?: number
  unitName?: string
  kind?: string
}

export interface PortionResult {
  grams: number
  adjusted: "count" | "cap" | null
}

/**
 * Resolve an item's grams with priors applied:
 *  - countable items use count × measured unit weight (trust the count, not
 *    the eyeballed pile),
 *  - otherwise a single-serving dish claimed above its ceiling is clamped.
 * Drinks pass through untouched — glass sizes are already well-estimated.
 */
export function applyPortionPriors(item: PortionInput): PortionResult {
  const grams = item.grams ?? 0
  if (item.kind === "drink") return { grams, adjusted: null }

  const count = item.count ?? 0
  if (count > 0 && count <= 40) {
    const unit = unitWeightFor(item.unitName ?? "", item.name)
    if (unit != null) {
      const fromCount = Math.round(count * unit)
      // only report an adjustment when it actually moved the number
      const moved = grams <= 0 || Math.abs(fromCount - grams) / Math.max(fromCount, grams) > 0.15
      return { grams: fromCount, adjusted: moved ? "count" : null }
    }
  }

  const cap = servingCapFor(item.name, item.searchQuery ?? "")
  if (cap && grams > cap.maxG) {
    return { grams: cap.maxG, adjusted: "cap" }
  }

  return { grams, adjusted: null }
}
