// Shared classifier for Oura tags (the user's manual annotations in the Oura
// app): drinks are mirrored into IntakeLog by the Oura sync; anything that
// isn't a drink is treated as a likely supplement/medication for display.
//
// Drink words are matched as words: a bare "rum" made Ferrum and Centrum 40 ml
// of spirits, mirrored into the alcohol log every morning.

import { normalizeSupplement } from "@/lib/supplement-normalize"
import { drinkProfile } from "@/lib/drink-catalog"

export type OuraTagKind =
  | "water" | "sparkling" | "coffee" | "tea" | "matcha" | "mate"
  | "juice" | "soda" | "milk"
  | "beer" | "wine" | "spirits" | "alcohol"
  | "med" | "other"

/** Intake types the Oura sync mirrors into IntakeLog. */
export const INTAKE_KINDS: ReadonlySet<OuraTagKind> = new Set([
  "water", "sparkling", "coffee", "tea", "matcha", "mate", "juice", "soda", "milk",
  "beer", "wine", "spirits", "alcohol",
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
  [/coffee|\bkava\b/, "coffee", 200],
  [/sparkling|perliv|mineralka|mineral(?:na)?\s*(?:water|voda)|bublink/, "sparkling", 330],
  [/\bwater\b|voda/, "water", 300],
  // Tea is a real intake type on the page, so it is classified here rather
  // than being lumped in with untracked drinks below.
  [/\btea\b|caj\b/, "tea", 250],
  [/beer|pivo/, "beer", 500],
  [/wine|vino/, "wine", 150],
  [/vodka|tequila|\brum\b|\bgin\b|whisky|whiskey|\bspirits?\b|borovicka|slivovica|\bshots? of\b/, "spirits", 40],
  [/cocktail|cider/, "alcohol", 330],
  [/\balcohol\b/, "alcohol", 330],
]

const ALCOHOLIC: ReadonlySet<OuraTagKind> = new Set(["beer", "wine", "spirits", "alcohol"])

export function classifyOuraTag(rawLabel: string): { kind: OuraTagKind; ml: number } {
  const label = fold(rawLabel.trim())
  const explicitMl = label.match(ML_RE)?.[1]
  const withMl = (kind: OuraTagKind, defMl: number) => ({ kind, ml: explicitMl ? parseInt(explicitMl) : defMl })
  // Alcohol-free beer reads "pivo" and "beer" like the real thing, so it is
  // settled before the rules below can count it as alcohol.
  const profile = drinkProfile(rawLabel)
  if (profile?.nonAlcoholic) return withMl(profile.type as OuraTagKind, profile.ml)
  for (const [re, kind, defMl] of DEFAULTS) {
    if (re.test(label)) {
      // A substance the supplement canon knows is never alcohol, whatever its
      // label happens to contain. It can still be a drink: "collagen coffee"
      // is a coffee and keeps its intake and caffeine rows.
      if (ALCOHOLIC.has(kind) && normalizeSupplement(rawLabel)) return { kind: "med", ml: 0 }
      return { kind, ml: explicitMl ? parseInt(explicitMl) : defMl }
    }
  }
  // Named drinks the rules above don't know — Kofola, Red Bull, kefir,
  // radler. A supplement the canon knows stays a supplement ("Electrolytes").
  // A stated dose ("400 mg", "1 tbl") marks a medicine however it's taken.
  const dosed = /\d\s*(mg|mcg|µg|ug)\b|\btbl\b|tablet|kapsul|capsul/.test(label)
  if (profile && !dosed && !normalizeSupplement(rawLabel)) return withMl(profile.type as OuraTagKind, profile.ml)
  // Other drinks: not tracked as intake, but also not medication
  if (/juice|smoothie|shake|soda|dzus/.test(label)) {
    return { kind: "other", ml: 0 }
  }
  // Everything else is shown as a supplement/med annotation
  return { kind: "med", ml: 0 }
}
