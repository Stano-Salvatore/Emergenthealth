// Personalized daily targets from body stats. Weight carries the well-founded
// scaling (hydration, caffeine, protein); calories use Mifflin-St Jeor when
// age and sex are known (the standard clinical BMR equation), falling back to
// the rough 30 kcal/kg estimate when they aren't.

export interface DailyTargets {
  waterMl: number
  caffeineMaxMg: number
  calories: number
  proteinG: number
  sugarMaxG: number
  bmi: number | null
  /** true when at least weight was available and targets are personalized */
  personalized: boolean
  /** "bmr" = Mifflin-St Jeor (weight+height+age+sex known), "rough" = 30 kcal/kg, "default" = no data */
  calorieBasis: "bmr" | "rough" | "default"
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Light-activity multiplier (sedentary job + some daily movement). Honest
// middle ground: 1.2 is bedridden, 1.55 assumes real training most days.
const ACTIVITY_FACTOR = 1.4

export interface TargetInputs {
  weightKg?: number | null
  heightCm?: number | null
  /** Four-digit birth year, e.g. 1995 */
  birthYear?: number | null
  sex?: "male" | "female" | null
}

/**
 * Compute daily targets.
 * - water: ~35 ml/kg (EFSA adequate-intake ballpark), 50 ml steps, 1.5–4 L
 * - caffeine: ~5.7 mg/kg/day (EFSA), never above the 400 mg adult ceiling
 * - protein: 1.2 g/kg (active-adult middle ground)
 * - calories: Mifflin-St Jeor × 1.4 when weight+height+age+sex are all known
 *   (10w + 6.25h − 5·age, +5 male / −161 female); else ~30 kcal/kg, rough
 * - sugar: WHO free-sugar guideline (~50 g at 2000 kcal), scaled to the target
 */
export function computeTargets(opts: TargetInputs): DailyTargets {
  const w = opts.weightKg && opts.weightKg >= 30 && opts.weightKg <= 250 ? opts.weightKg : null
  const h = opts.heightCm && opts.heightCm >= 120 && opts.heightCm <= 230 ? opts.heightCm : null

  const thisYear = new Date().getFullYear()
  const age = opts.birthYear && opts.birthYear >= thisYear - 110 && opts.birthYear <= thisYear - 10
    ? thisYear - opts.birthYear
    : null
  const sex = opts.sex === "male" || opts.sex === "female" ? opts.sex : null

  let calories: number
  let calorieBasis: DailyTargets["calorieBasis"]
  if (w && h && age != null && sex) {
    const bmr = 10 * w + 6.25 * h - 5 * age + (sex === "male" ? 5 : -161)
    calories = clamp(roundTo(bmr * ACTIVITY_FACTOR, 50), 1200, 4000)
    calorieBasis = "bmr"
  } else if (w) {
    calories = clamp(roundTo(30 * w, 50), 1400, 3500)
    calorieBasis = "rough"
  } else {
    calories = 2200
    calorieBasis = "default"
  }

  return {
    waterMl: w ? clamp(roundTo(35 * w, 50), 1500, 4000) : 2000,
    caffeineMaxMg: w ? Math.min(400, roundTo(5.7 * w, 10)) : 400,
    calories,
    proteinG: w ? Math.round(1.2 * w) : 80,
    sugarMaxG: Math.round(50 * (calories / 2000)),
    bmi: w && h ? Math.round((w / Math.pow(h / 100, 2)) * 10) / 10 : null,
    personalized: w != null,
    calorieBasis,
  }
}
