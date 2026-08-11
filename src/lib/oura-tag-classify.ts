// Shared classifier for Oura tags (the user's manual annotations in the Oura
// app): drinks are mirrored into IntakeLog by the Oura sync; anything that
// isn't a drink is treated as a likely supplement/medication for display.

export type OuraTagKind =
  | "water" | "sparkling" | "coffee" | "tea" | "matcha"
  | "beer" | "wine" | "spirits" | "alcohol"
  | "med" | "other"

/** Intake types the Oura sync mirrors into IntakeLog. */
export const INTAKE_KINDS: ReadonlySet<OuraTagKind> = new Set([
  "water", "sparkling", "coffee", "tea", "matcha", "beer", "wine", "spirits", "alcohol",
])

const ML_RE = /(\d+)\s*ml/i

// Diacritics-insensitive, so Slovak labels (káva, čaj, víno…) match plain rules
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

// Default volumes when the tag doesn't carry an explicit "###ml". Drinks map
// to the same specific types the Intake page uses (beer stays beer, not a
// generic "alcohol"), so totals line up across the app.
const DEFAULTS: [RegExp, OuraTagKind, number][] = [
  // before the coffee rules so "matcha latte" counts as matcha, not coffee
  [/matcha/, "matcha", 250],
  [/espresso/, "coffee", 30],
  [/macchiato/, "coffee", 60],
  [/flat.?white/, "coffee", 160],
  [/cappuccino/, "coffee", 180],
  [/latte/, "coffee", 300],
  [/americano/, "coffee", 200],
  [/cold.?brew/, "coffee", 300],
  [/batch.?brew|v60|aeropress|pour.?over|filter coffee/, "coffee", 250],
  [/coffee|kava/, "coffee", 200],
  [/sparkling|perliv|mineral|bublink/, "sparkling", 330],
  [/\bwater\b|voda/, "water", 300],
  // Tea is a real intake type on the page, so it is classified here rather
  // than being lumped in with untracked drinks below.
  [/\btea\b|caj\b/, "tea", 250],
  [/beer|pivo/, "beer", 500],
  [/wine|vino/, "wine", 150],
  [/vodka|rum|\bgin\b|whisky|whiskey|spirit|borovicka|slivovica|shot/, "spirits", 40],
  [/cocktail|cider/, "alcohol", 330],
  [/\balcohol\b/, "alcohol", 330],
]

export function classifyOuraTag(rawLabel: string): { kind: OuraTagKind; ml: number } {
  const label = fold(rawLabel.trim())
  const explicitMl = label.match(ML_RE)?.[1]
  for (const [re, kind, defMl] of DEFAULTS) {
    if (re.test(label)) {
      return { kind, ml: explicitMl ? parseInt(explicitMl) : defMl }
    }
  }
  // Other drinks: not tracked as intake, but also not medication
  if (/juice|smoothie|shake|soda|dzus/.test(label)) {
    return { kind: "other", ml: 0 }
  }
  // Everything else is shown as a supplement/med annotation
  return { kind: "med", ml: 0 }
}
