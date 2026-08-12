// Which analyzed meal items should be mirrored into the drinks tracker.
// Pure and forgiving: photo analyses come from different app versions, so an
// item missing `kind` still mirrors when it clearly carries a drink type, and
// a missing volume falls back to the gram estimate (density ≈ 1 for drinks).

export const MIRROR_DRINK_TYPES = new Set([
  "water", "sparkling", "coffee", "tea", "matcha", "beer", "wine", "spirits", "alcohol", "juice", "soda", "milk", "other",
])

export interface MirrorableDrink {
  type: string
  volumeMl: number
  name: string
}

export function extractMirrorableDrinks(items: unknown): MirrorableDrink[] {
  if (!Array.isArray(items)) return []
  const out: MirrorableDrink[] = []
  for (const raw of items.slice(0, 20)) {
    const it = raw as { kind?: unknown; drinkType?: unknown; volumeMl?: unknown; grams?: unknown; name?: unknown }
    const drinkType = typeof it?.drinkType === "string" ? it.drinkType : ""
    const isDrink = it?.kind === "drink" || (it?.kind == null && MIRROR_DRINK_TYPES.has(drinkType))
    if (!isDrink || !MIRROR_DRINK_TYPES.has(drinkType)) continue
    let volumeMl = Math.round(Number(it?.volumeMl))
    if (!Number.isFinite(volumeMl) || volumeMl <= 0) volumeMl = Math.round(Number(it?.grams))
    if (!Number.isFinite(volumeMl) || volumeMl <= 0 || volumeMl > 3000) continue
    out.push({
      type: drinkType,
      volumeMl,
      name: typeof it?.name === "string" ? it.name.trim().slice(0, 80) : "",
    })
  }
  return out
}
