// Meal-photo analysis — Claude looks at a photo, identifies the food, and
// estimates calories and macros per item. Structured output guarantees the
// response parses; totals are summed in code, not by the model.

import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Drink types mirror IntakeLog.type so recognized drinks can feed the
// drinks/caffeine tracker directly.
export const DRINK_TYPES = ["water", "sparkling", "coffee", "tea", "matcha", "beer", "wine", "spirits", "alcohol", "juice", "soda", "milk", "other"] as const

export interface FoodItem {
  kind: "food" | "drink"
  name: string
  portion: string      // e.g. "1 cup", "150 g", "2 slices", "330 ml can"
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  drinkType: string    // one of DRINK_TYPES for drinks; "none" for food
  volumeMl: number     // estimated ml for drinks; 0 for food
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
}

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "name", "portion", "calories", "proteinG", "carbsG", "fatG", "drinkType", "volumeMl"],
  properties: {
    kind: { type: "string", enum: ["food", "drink"], description: "Whether this item is eaten or drunk" },
    name: { type: "string", description: "The item, e.g. 'Grilled chicken breast' or 'Fresh orange juice'" },
    portion: { type: "string", description: "Estimated portion as seen, e.g. '150 g', '1 cup', '330 ml can'" },
    calories: { type: "integer", description: "Estimated kcal for this portion" },
    proteinG: { type: "number", description: "Estimated protein in grams" },
    carbsG: { type: "number", description: "Estimated carbohydrates in grams" },
    fatG: { type: "number", description: "Estimated fat in grams" },
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

/**
 * Analyze a meal photo. Returns null when the request can't be served
 * (bad image, model refusal) — the caller turns that into a 4xx/5xx.
 * `hint` is the user's optional note, e.g. "the sauce is low-fat yoghurt".
 */
export async function analyzeMealPhoto(imageDataUrl: string, hint?: string): Promise<FoodAnalysis | null> {
  const img = parseDataUrl(imageDataUrl)
  if (!img) return null

  const prompt =
    "Identify the food and drinks in this photo and estimate their nutrition. " +
    "List each distinct food or drink as its own item with the portion you can actually see — when unsure, estimate conservatively rather than guessing high. " +
    "Use the visual context (plate size, glass/cup/bottle size, cutlery) to judge portions and drink volumes. " +
    "Also estimate the notable vitamins and minerals — read labels when visible (juice cartons, cans, bottles)." +
    (hint?.trim() ? `\n\nThe user adds: "${hint.trim().slice(0, 300)}"` : "")

  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    output_config: {
      effort: "low", // portion estimation is quick work; keeps the camera-to-result wait short
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: img.mediaType as "image/jpeg", data: img.data },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  })

  if (response.stop_reason === "refusal") return null
  const text = response.content.find(b => b.type === "text")?.text
  if (!text) return null

  let parsed: Omit<FoodAnalysis, "calories" | "proteinG" | "carbsG" | "fatG">
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  const round1 = (n: number) => Math.round(n * 10) / 10
  return {
    ...parsed,
    micros: (parsed.micros ?? []).slice(0, 8),
    calories: Math.round(parsed.items.reduce((s, i) => s + (i.calories || 0), 0)),
    proteinG: round1(parsed.items.reduce((s, i) => s + (i.proteinG || 0), 0)),
    carbsG: round1(parsed.items.reduce((s, i) => s + (i.carbsG || 0), 0)),
    fatG: round1(parsed.items.reduce((s, i) => s + (i.fatG || 0), 0)),
  }
}
