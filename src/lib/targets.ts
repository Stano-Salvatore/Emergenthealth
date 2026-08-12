// Personalized daily targets from body stats. Weight carries the well-founded
// scaling (hydration, caffeine, protein); calories are a deliberately rough
// maintenance estimate — a real BMR needs age and sex, which we don't ask for.

export interface DailyTargets {
  waterMl: number
  caffeineMaxMg: number
  calories: number
  proteinG: number
  sugarMaxG: number
  bmi: number | null
  /** true when at least weight was available and targets are personalized */
  personalized: boolean
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Compute daily targets.
 * - water: ~35 ml/kg (EFSA adequate-intake ballpark), 50 ml steps, 1.5–4 L
 * - caffeine: ~5.7 mg/kg/day (EFSA), never above the 400 mg adult ceiling
 * - protein: 1.2 g/kg (active-adult middle ground)
 * - calories: ~30 kcal/kg — rough maintenance, labeled as such in the UI
 * - sugar: WHO free-sugar guideline (~50 g at 2000 kcal), scaled to the target
 */
export function computeTargets(opts: { weightKg?: number | null; heightCm?: number | null }): DailyTargets {
  const w = opts.weightKg && opts.weightKg >= 30 && opts.weightKg <= 250 ? opts.weightKg : null
  const h = opts.heightCm && opts.heightCm >= 120 && opts.heightCm <= 230 ? opts.heightCm : null

  const calories = w ? clamp(roundTo(30 * w, 50), 1400, 3500) : 2200
  return {
    waterMl: w ? clamp(roundTo(35 * w, 50), 1500, 4000) : 2000,
    caffeineMaxMg: w ? Math.min(400, roundTo(5.7 * w, 10)) : 400,
    calories,
    proteinG: w ? Math.round(1.2 * w) : 80,
    sugarMaxG: Math.round(50 * (calories / 2000)),
    bmi: w && h ? Math.round((w / Math.pow(h / 100, 2)) * 10) / 10 : null,
    personalized: w != null,
  }
}
