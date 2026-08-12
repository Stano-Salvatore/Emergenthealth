// Meal-photo analysis — Claude looks at a photo, identifies the food, and
// estimates calories and macros per item. Structured output guarantees the
// response parses; totals are summed in code, not by the model.

import Anthropic from "@anthropic-ai/sdk"
import { searchFood, nutrientsForGrams, notableMicros, type DbNutrients } from "@/lib/nutrient-db"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Drink types mirror IntakeLog.type so recognized drinks can feed the
// drinks/caffeine tracker directly.
export const DRINK_TYPES = ["water", "sparkling", "coffee", "tea", "matcha", "beer", "wine", "spirits", "alcohol", "juice", "soda", "milk", "other"] as const

export interface FoodItem {
  kind: "food" | "drink"
  name: string
  portion: string      // e.g. "1 cup", "150 g", "2 slices", "330 ml can"
  grams: number        // estimated edible weight in grams (≈ ml for drinks)
  searchQuery: string  // plain US-English lookup phrase for the nutrient database
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  sugarG: number
  drinkType: string    // one of DRINK_TYPES for drinks; "none" for food
  volumeMl: number     // estimated ml for drinks; 0 for food
  // filled in server-side after the USDA lookup
  source?: "db" | "est"
  dbName?: string      // matched USDA description when source === "db"
}

export interface Micronutrient {
  name: string         // e.g. "Vitamin C", "Iron", "Calcium"
  amount: number
  unit: "mg" | "µg" | "g" | "IU"
  dailyPct: number     // % of an adult's daily value, rough estimate
}

export interface FoodAnalysis {
  isFood: boolean
  name: string
  mealType: "breakfast" | "lunch" | "dinner" | "snack" | "other"
  items: FoodItem[]
  micros: Micronutrient[]
  healthNote: string
  // computed in code from items
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  sugarG: number
}

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "name", "portion", "grams", "searchQuery", "calories", "proteinG", "carbsG", "fatG", "sugarG", "drinkType", "volumeMl"],
  properties: {
    kind: { type: "string", enum: ["food", "drink"], description: "Whether this item is eaten or drunk" },
    name: { type: "string", description: "The item, e.g. 'Grilled chicken breast' or 'Fresh orange juice'" },
    portion: { type: "string", description: "Estimated portion as seen, e.g. '150 g', '1 cup', '330 ml can'" },
    grams: { type: "integer", description: "Estimated edible weight of this portion in grams (for drinks: ≈ the ml volume). Judge from plate/glass size." },
    searchQuery: {
      type: "string",
      description: "A plain US-English phrase to look this item up in the USDA food-composition database: base food plus preparation, no brands or quantities — e.g. 'chicken breast meat only roasted', 'orange juice raw', 'rice white long-grain cooked', 'tomatoes red ripe raw'.",
    },
    calories: { type: "integer", description: "Estimated kcal for this portion" },
    proteinG: { type: "number", description: "Estimated protein in grams" },
    carbsG: { type: "number", description: "Estimated carbohydrates in grams" },
    fatG: { type: "number", description: "Estimated fat in grams" },
    sugarG: { type: "number", description: "Estimated sugars in grams (part of the carbohydrates)" },
    drinkType: {
      type: "string",
      enum: [...DRINK_TYPES, "none"],
      description: "For drinks: the closest category (plain/mineral water → water, cola/energy drinks → soda, cocktails → alcohol). 'none' for food.",
    },
    volumeMl: { type: "integer", description: "For drinks: estimated volume in ml (e.g. 250, 330, 500). 0 for food." },
  },
} as const

const MICRO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "amount", "unit", "dailyPct"],
  properties: {
    name: { type: "string", description: "Micronutrient name, e.g. 'Vitamin C', 'Iron', 'Calcium', 'Potassium'" },
    amount: { type: "number", description: "Estimated amount in the whole meal/drink" },
    unit: { type: "string", enum: ["mg", "µg", "g", "IU"] },
    dailyPct: { type: "integer", description: "Rough % of an adult's recommended daily value" },
  },
} as const

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isFood", "name", "mealType", "items", "micros", "healthNote"],
  properties: {
    isFood: { type: "boolean", description: "false when the photo shows neither food nor drink" },
    name: { type: "string", description: "Short name for the whole meal or drink, e.g. 'Chicken caesar salad', 'Fresh orange juice'. Empty string if not food." },
    mealType: {
      type: "string",
      enum: ["breakfast", "lunch", "dinner", "snack", "other"],
      description: "Best guess from the food itself (not the time of day). Use 'other' for a standalone drink.",
    },
    items: { type: "array", description: "Each distinct food or drink in the photo. Empty if none.", items: ITEM_SCHEMA },
    micros: {
      type: "array",
      description: "Up to 8 NOTABLE vitamins and minerals across everything in the photo — only ones present in meaningful amounts (roughly ≥8% of daily value). Empty when nothing notable.",
      items: MICRO_SCHEMA,
    },
    healthNote: {
      type: "string",
      description: "One friendly, non-preachy sentence about the nutrition — what's good, or a gentle heads-up. Empty string if not food.",
    },
  },
} as const

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

/** Split a data URL into its media type and base64 payload. */
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m || !MEDIA_TYPES.has(m[1])) return null
  return { mediaType: m[1], data: m[2] }
}

export interface AnalyzeOptions {
  /** The user's note, e.g. "the sauce is low-fat yoghurt", "oat milk, 500 ml glass". */
  hint?: string
  /** Second photo of the packaging's nutrition label — exact values beat visual guessing. */
  labelImageDataUrl?: string
  /** The previous analysis when the user asks for a re-run with corrections. */
  previous?: unknown
}

/**
 * Analyze a meal photo. Returns null when the request can't be served
 * (bad image, model refusal) — the caller turns that into a 4xx/5xx.
 * A refine pass (hint/label/previous present) runs at higher effort: the
 * user explicitly asked for precision, so a longer wait is fine.
 */
export async function analyzeMealPhoto(imageDataUrl: string, opts: AnalyzeOptions = {}): Promise<FoodAnalysis | null> {
  const img = parseDataUrl(imageDataUrl)
  if (!img) return null
  const label = opts.labelImageDataUrl ? parseDataUrl(opts.labelImageDataUrl) : null
  const refining = Boolean(label || opts.previous || opts.hint?.trim())

  let prompt =
    "Identify the food and drinks in the photo and estimate their nutrition. " +
    "List each distinct food or drink as its own item with the portion you can actually see — when unsure, estimate conservatively rather than guessing high. " +
    "Use the visual context (plate size, glass/cup/bottle size, cutlery) to judge portions and drink volumes. " +
    "Also estimate the notable vitamins and minerals — read labels when visible (juice cartons, cans, bottles)."
  if (label) {
    prompt +=
      "\n\nThe second photo is the product's nutrition label. Read its exact per-100g/per-serving values and scale them to the portion visible in the first photo — label numbers override visual estimates, including vitamins and minerals."
  }
  if (opts.previous) {
    prompt +=
      `\n\nYour previous estimate was:\n${JSON.stringify(opts.previous).slice(0, 4000)}\n` +
      "Re-estimate with the user's correction below applied. Keep what the correction doesn't touch."
  }
  if (opts.hint?.trim()) {
    prompt += `\n\nThe user says: "${opts.hint.trim().slice(0, 300)}"`
  }

  type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
  const imageBlock = (i: { mediaType: string; data: string }): ImageBlock => ({
    type: "image",
    source: { type: "base64", media_type: i.mediaType as "image/jpeg", data: i.data },
  })

  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 8192,
    output_config: {
      // First pass optimizes the camera-to-result wait; a refine pass trades
      // a longer wait for accuracy since the user asked for it.
      effort: refining ? "high" : "low",
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          imageBlock(img),
          ...(label ? [imageBlock(label)] : []),
          { type: "text", text: prompt },
        ],
      },
    ],
  })

  if (response.stop_reason === "refusal") return null
  const text = response.content.find(b => b.type === "text")?.text
  if (!text) return null

  let parsed: Omit<FoodAnalysis, "calories" | "proteinG" | "carbsG" | "fatG" | "sugarG">
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  return reconcileWithDb(parsed)
}

/**
 * Swap model-estimated nutrition for USDA facts wherever an item matches the
 * database: the model's job is identifying the food and the portion; the
 * measured per-100g values do the rest. Unmatched items keep the estimate,
 * and every item is marked "db" or "est" so the UI can say which is which.
 */
export function reconcileWithDb(parsed: Omit<FoodAnalysis, "calories" | "proteinG" | "carbsG" | "fatG" | "sugarG">): FoodAnalysis {
  const round1 = (n: number) => Math.round(n * 10) / 10
  const dbTotals: Record<string, number> = {}
  let anyDb = false

  const items = (parsed.items ?? []).map(it => {
    const grams = it.grams > 0 ? it.grams : it.kind === "drink" && it.volumeMl > 0 ? it.volumeMl : 0
    const match = grams > 0 ? searchFood(it.searchQuery || it.name) : null
    if (!match) return { ...it, source: "est" as const }
    const n = nutrientsForGrams(match.per100, grams)
    anyDb = true
    for (const [k, v] of Object.entries(n)) dbTotals[k] = (dbTotals[k] ?? 0) + v
    return {
      ...it,
      source: "db" as const,
      dbName: match.desc,
      calories: Math.round(n.kcal),
      proteinG: round1(n.protein),
      carbsG: round1(n.carb),
      fatG: round1(n.fat),
      sugarG: round1(n.sugar),
    }
  })

  // Micros: measured values for matched items, plus the model's estimates for
  // nutrients only the unmatched items would carry.
  const dbMicros = anyDb ? notableMicros(dbTotals as unknown as DbNutrients) : []
  const dbNames = new Set(dbMicros.map(m => m.name.toLowerCase()))
  const hasEstItems = items.some(i => i.source === "est")
  const estMicros = hasEstItems
    ? (parsed.micros ?? []).filter(m => m?.name && !dbNames.has(m.name.toLowerCase()))
    : []
  const micros = [...dbMicros, ...estMicros].slice(0, 8)

  return {
    ...parsed,
    items,
    micros,
    calories: Math.round(items.reduce((s, i) => s + (i.calories || 0), 0)),
    proteinG: round1(items.reduce((s, i) => s + (i.proteinG || 0), 0)),
    carbsG: round1(items.reduce((s, i) => s + (i.carbsG || 0), 0)),
    fatG: round1(items.reduce((s, i) => s + (i.fatG || 0), 0)),
    sugarG: round1(items.reduce((s, i) => s + (i.sugarG || 0), 0)),
  }
}
