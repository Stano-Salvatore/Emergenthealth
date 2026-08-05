// Shared classifier for Oura tags (the user's manual annotations in the Oura
// app): drinks are mirrored into IntakeLog by the Oura sync; anything that
// isn't a drink is treated as a likely supplement/medication for display.

export type OuraTagKind = "water" | "coffee" | "alcohol" | "med" | "other"

const ML_RE = /(\d+)\s*ml/i

// Default volumes when the tag doesn't carry an explicit "###ml"
const DEFAULTS: [RegExp, OuraTagKind, number][] = [
  [/espresso/, "coffee", 30],
  [/macchiato/, "coffee", 60],
  [/flat.?white/, "coffee", 160],
  [/cappuccino/, "coffee", 180],
  [/latte/, "coffee", 300],
  [/americano/, "coffee", 200],
  [/v60|aeropress|pour.?over/, "coffee", 300],
  [/coffee|kava|káva/, "coffee", 200],
  [/\bwater\b|voda/, "water", 300],
  [/beer|pivo/, "alcohol", 500],
  [/wine|vino|víno/, "alcohol", 150],
  [/vodka|rum|\bgin\b|whisky|whiskey|spirit|borovi(c|č)ka|slivovica|shot/, "alcohol", 40],
  [/cocktail|cider/, "alcohol", 330],
  [/\balcohol\b/, "alcohol", 330],
]

export function classifyOuraTag(rawLabel: string): { kind: OuraTagKind; ml: number } {
  const label = rawLabel.trim().toLowerCase()
  const explicitMl = label.match(ML_RE)?.[1]
  for (const [re, kind, defMl] of DEFAULTS) {
    if (re.test(label)) {
      return { kind, ml: explicitMl ? parseInt(explicitMl) : defMl }
    }
  }
  // Other drinks: not tracked as intake, but also not medication
  if (/juice|smoothie|shake|soda|\btea\b|čaj/.test(label)) {
    return { kind: "other", ml: 0 }
  }
  // Everything else is shown as a supplement/med annotation
  return { kind: "med", ml: 0 }
}
