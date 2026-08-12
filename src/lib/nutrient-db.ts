// USDA SR28 nutrient reference — 8,789 foods with per-100g values, bundled as
// JSON (public-domain USDA data). Claude's vision identifies *what and how
// much*; this table supplies *the facts*, so nutrition numbers come from
// measurements instead of the model's memory whenever a food matches.

import raw from "@/data/usda-sr28.json"

const NUTRIENTS = raw.nutrients as string[]
const FOODS = raw.foods as (string | number)[][]

export interface DbNutrients {
  kcal: number; protein: number; fat: number; carb: number; fiber: number; sugar: number
  ca: number; fe: number; mg: number; k: number; na: number; zn: number; se: number
  vitC: number; b1: number; b2: number; b3: number; b6: number; folate: number
  b12: number; vitA: number; vitE: number; vitD: number; vitK: number
}

export interface DbMatch {
  /** USDA long description, e.g. "Chicken, broilers or fryers, breast, meat only, cooked, roasted" */
  desc: string
  /** Values per 100 g */
  per100: DbNutrients
  /** 0..1 — how well the query tokens covered the description */
  score: number
}

export type MicroUnit = "mg" | "µg" | "g" | "IU"

/** FDA adult daily values, in each nutrient's own unit (labels & %DV math). */
export const DAILY_VALUES: Record<string, { label: string; dv: number; unit: MicroUnit }> = {
  fiber:  { label: "Fiber",       dv: 28,   unit: "g" },
  ca:     { label: "Calcium",     dv: 1300, unit: "mg" },
  fe:     { label: "Iron",        dv: 18,   unit: "mg" },
  mg:     { label: "Magnesium",   dv: 420,  unit: "mg" },
  k:      { label: "Potassium",   dv: 4700, unit: "mg" },
  na:     { label: "Sodium",      dv: 2300, unit: "mg" },
  zn:     { label: "Zinc",        dv: 11,   unit: "mg" },
  se:     { label: "Selenium",    dv: 55,   unit: "µg" },
  vitC:   { label: "Vitamin C",   dv: 90,   unit: "mg" },
  b1:     { label: "Thiamin (B1)", dv: 1.2, unit: "mg" },
  b2:     { label: "Riboflavin (B2)", dv: 1.3, unit: "mg" },
  b3:     { label: "Niacin (B3)", dv: 16,   unit: "mg" },
  b6:     { label: "Vitamin B6",  dv: 1.7,  unit: "mg" },
  folate: { label: "Folate",      dv: 400,  unit: "µg" },
  b12:    { label: "Vitamin B12", dv: 2.4,  unit: "µg" },
  vitA:   { label: "Vitamin A",   dv: 900,  unit: "µg" },
  vitE:   { label: "Vitamin E",   dv: 15,   unit: "mg" },
  vitD:   { label: "Vitamin D",   dv: 20,   unit: "µg" },
  vitK:   { label: "Vitamin K",   dv: 120,  unit: "µg" },
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
const tokenize = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(t => t.length > 1)

// Words that appear constantly in queries but carry little signal on their own.
const WEAK = new Set(["raw", "fresh", "cooked", "with", "without", "and", "of", "the", "plain", "regular", "whole", "sliced", "piece", "pieces"])

// Pre-tokenized index, built once per process.
interface IndexEntry { desc: string; tokens: Set<string>; tokenCount: number; row: (string | number)[] }
let INDEX: IndexEntry[] | null = null
function index(): IndexEntry[] {
  if (!INDEX) {
    INDEX = FOODS.map(row => {
      const desc = row[0] as string
      const tokens = new Set(tokenize(desc))
      return { desc, tokens, tokenCount: tokens.size, row }
    })
  }
  return INDEX
}

function toNutrients(row: (string | number)[]): DbNutrients {
  const out = {} as Record<string, number>
  NUTRIENTS.forEach((n, i) => { out[n] = (row[i + 1] as number) || 0 })
  return out as unknown as DbNutrients
}

/**
 * Find the best USDA food for a free-text query like "chicken breast roasted".
 * Scoring is query-coverage first (every query token should appear in the
 * description, prefix matches count), with a brevity tie-break so "Bananas,
 * raw" beats "Bananas, dehydrated, or banana powder".
 */
export function searchFood(query: string): DbMatch | null {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return null
  const strong = qTokens.filter(t => !WEAK.has(t))
  const scored: { e: IndexEntry; score: number }[] = []

  for (const e of index()) {
    let hits = 0
    let strongHits = 0
    for (const t of qTokens) {
      let hit = e.tokens.has(t)
      if (!hit && t.length >= 4) {
        for (const dt of e.tokens) { if (dt.startsWith(t) || t.startsWith(dt) && dt.length >= 4) { hit = true; break } }
      }
      if (hit) { hits++; if (!WEAK.has(t)) strongHits++ }
    }
    if (strong.length > 0 && strongHits === 0) continue
    const coverage = hits / qTokens.length
    if (coverage < 0.5) continue
    // brevity bonus: fewer leftover description tokens → closer match
    const brevity = 1 / (1 + Math.max(0, e.tokenCount - hits))
    scored.push({ e, score: coverage * 0.8 + brevity * 0.2 })
  }

  if (scored.length === 0) return null
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (best.score < 0.55) return null
  return { desc: best.e.desc, per100: toNutrients(best.e.row), score: Math.round(best.score * 100) / 100 }
}

/** Scale per-100g values to a portion. */
export function nutrientsForGrams(per100: DbNutrients, grams: number): DbNutrients {
  const f = grams / 100
  const out = {} as Record<string, number>
  for (const [k, v] of Object.entries(per100)) out[k] = Math.round(v * f * 1000) / 1000
  return out as unknown as DbNutrients
}

/**
 * Notable micronutrients for a set of absolute nutrient amounts: everything at
 * ≥ 5% of the FDA daily value, sorted by coverage. Sodium is reported only
 * when high (≥ 20% DV) — it's a "watch" nutrient, not one to celebrate.
 */
export function notableMicros(totals: DbNutrients): { name: string; amount: number; unit: MicroUnit; dailyPct: number }[] {
  const out: { name: string; amount: number; unit: MicroUnit; dailyPct: number }[] = []
  for (const [key, meta] of Object.entries(DAILY_VALUES)) {
    const amount = (totals as unknown as Record<string, number>)[key] ?? 0
    if (amount <= 0) continue
    const pct = (amount / meta.dv) * 100
    if (pct < 5) continue
    if (key === "na" && pct < 20) continue
    out.push({ name: meta.label, amount: Math.round(amount * 100) / 100, unit: meta.unit, dailyPct: Math.round(pct) })
  }
  return out.sort((a, b) => b.dailyPct - a.dailyPct).slice(0, 8)
}
