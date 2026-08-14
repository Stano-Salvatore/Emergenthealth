// Shared caffeine knowledge: the manual quick-add compounds, display labels,
// and the estimator that turns a logged drink (type + label + ml) into a
// caffeine amount so intake entries auto-feed the caffeine tracker.

export const LIMIT_MG = 400

/** Manual quick-add compounds on the Caffeine tab. */
export const COMPOUNDS: Record<string, { label: string; mg: number; emoji: string }> = {
  espresso:      { label: "Espresso",      mg: 63,  emoji: "☕" },
  filter_coffee: { label: "Filter coffee", mg: 140, emoji: "☕" },
  green_tea:     { label: "Green tea",     mg: 30,  emoji: "🍵" },
  black_tea:     { label: "Black tea",     mg: 50,  emoji: "🍵" },
  matcha:        { label: "Matcha",        mg: 70,  emoji: "🍵" },
  mate:          { label: "Yerba mate",    mg: 80,  emoji: "🧉" },
  energy_drink:  { label: "Energy drink",  mg: 80,  emoji: "⚡" },
  pre_workout:   { label: "Pre-workout",   mg: 200, emoji: "💪" },
  cola:          { label: "Cola (330ml)",  mg: 35,  emoji: "🥤" },
}

/** Labels for every compound that can appear in the log, incl. auto-logged drinks. */
export const COMPOUND_LABELS: Record<string, { label: string; emoji: string }> = {
  ...Object.fromEntries(Object.entries(COMPOUNDS).map(([k, v]) => [k, { label: v.label, emoji: v.emoji }])),
  coffee:     { label: "Coffee",     emoji: "☕" },
  americano:  { label: "Americano",  emoji: "☕" },
  latte:      { label: "Latte",      emoji: "☕" },
  flat_white: { label: "Flat white", emoji: "☕" },
  cappuccino: { label: "Cappuccino", emoji: "☕" },
  cold_brew:  { label: "Cold brew",  emoji: "🧊" },
  tea:        { label: "Tea",        emoji: "🍵" },
}

export const HALF_LIFE_H = 5

/** Caffeine still circulating after `hours`, at the ~5h half-life. */
export const decayed = (mg: number, hours: number, halfLifeH = HALF_LIFE_H) =>
  Math.round(mg * Math.pow(0.5, hours / halfLifeH))

/** Sum a set of doses down to what is active at `now`. */
export function activeFromDoses(
  doses: { caffeineMg: number; loggedAt: Date }[],
  now = Date.now(),
  halfLifeH = HALF_LIFE_H,
): number {
  return Math.round(doses.reduce(
    (sum, d) => sum + d.caffeineMg * Math.pow(0.5, (now - d.loggedAt.getTime()) / 3600_000 / halfLifeH), 0))
}

/** Hours until the next 23:00 \u2014 the "will it bother my sleep" reference point. */
export function hoursToBedtime(from = new Date()): number {
  const bed = new Date(from)
  bed.setHours(23, 0, 0, 0)
  if (bed <= from) bed.setDate(bed.getDate() + 1)
  return (bed.getTime() - from.getTime()) / 3600_000
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

const espressoShots = (ml: number) => Math.max(1, Math.round(ml / 35))

/**
 * Estimate caffeine for an intake drink. Label is whatever the entry carries
 * (quick-add name, Oura tag text) — it picks the drink style; ml scales
 * brewed drinks. Returns null for non-caffeinated types.
 */
export function estimateCaffeine(type: string, label: string, amountMl: number): { compound: string; mg: number } | null {
  const l = fold(label)
  const ml = Math.max(0, amountMl)

  if (type === "matcha") return { compound: "matcha", mg: Math.round(ml * 0.28) || 70 }
  if (type === "tea")    return { compound: "tea",    mg: Math.round(ml * 0.2)  || 50 }
  if (type === "mate")   return { compound: "mate",   mg: Math.round(ml * 0.15) || 80 }
  // Checked before the coffee-only guard below, because nobody logging
  // "Maté by Mana Roots" picks "coffee" from a dropdown first. Without this it
  // fell through to the generic coffee default at 0.4 mg/ml — a 500ml gourd
  // logged as ~200mg instead of ~80, and that inflated figure fed body-load,
  // the bedtime-clearance chart and every caffeine pattern downstream.
  if (/yerba|mat[eé]\b|guayusa/.test(l)) return { compound: "mate", mg: Math.round(ml * 0.15) || 80 }

  if (type !== "coffee") return null

  if (/espresso|macchiato/.test(l))       return { compound: "espresso",   mg: 63 * espressoShots(ml || 30) }
  if (/flat.?white/.test(l))              return { compound: "flat_white", mg: 126 }
  if (/cappuccino/.test(l))               return { compound: "cappuccino", mg: 63 }
  if (/latte/.test(l))                    return { compound: "latte",      mg: 63 }
  if (/americano/.test(l))                return { compound: "americano",  mg: ml >= 200 ? 126 : 63 }
  if (/cold.?brew/.test(l))               return { compound: "cold_brew",  mg: Math.round(ml * 0.4) || 120 }
  if (/batch|filter|v60|aeropress|pour/.test(l)) return { compound: "filter_coffee", mg: Math.round(ml * 0.4) || 100 }
  // tiny volumes with no label are espresso shots, everything else brewed
  if (ml > 0 && ml <= 60) return { compound: "espresso", mg: 63 * espressoShots(ml) }
  return { compound: "coffee", mg: Math.round(ml * 0.4) || 80 }
}
