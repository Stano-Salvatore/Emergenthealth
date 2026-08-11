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
