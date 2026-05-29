import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const ML_RE = /(\d+)\s*ml/i

// Default volumes when a tag is recognised as a drink but has no explicit ml
const DEFAULT_ML: Record<string, number> = {
  water:       300,  // a glass
  espresso:     30,
  macchiato:    60,
  "flat white": 160,
  cappuccino:  180,
  latte:       300,
  americano:   200,
  coffee:      200,  // generic fallback
  v60:         300,
  aeropress:   200,
  "pour over": 300,
  tea:         250,
  beer:        330,
  wine:        150,
  spirit:       40,
  cocktail:    200,
  whisky:       40,
  whiskey:      40,
  vodka:        40,
  rum:          40,
  gin:          40,
  cider:       330,
}

function defaultMlForType(label: string, type: string): number {
  const l = label.toLowerCase()
  // Try specific drink names first
  for (const [key, ml] of Object.entries(DEFAULT_ML)) {
    if (l.includes(key)) return ml
  }
  // Fall back to type defaults
  if (type === "water") return 300
  if (type === "coffee") return 200
  if (type === "tea") return 250
  if (type === "alcohol") return 200
  return 200
}

function drinkType(label: string): { type: string; emoji: string } | null {
  const l = label.toLowerCase()

  if (/\bwater\b/.test(l)) return { type: "water", emoji: "💧" }
  if (/coffee|espresso|cappuccino|latte|americano|v60|aeropress|pour.?over|flat.?white|macchiato/.test(l))
    return { type: "coffee", emoji: "☕" }
  if (/\btea\b/.test(l)) return { type: "tea", emoji: "🍵" }
  if (/\balcohol\b|beer|wine|\bspirit\b|cocktail|whisky|whiskey|vodka|rum|\bgin\b|cider/.test(l))
    return { type: "alcohol", emoji: "🍺" }

  // Named drinks without a specific type
  if (/juice|smoothie|shake|soda|energy.?drink|beverage|protein/.test(l))
    return { type: "other", emoji: "🥤" }

  // Any remaining entry with an ml amount that isn't a medication/supplement
  const hasMl = ML_RE.test(l)
  const isMed = /vitamin|supplement|pill|tablet|capsule|medication|medicine|drug|\bmg\b/.test(l)
  if (hasMl && !isMed) return { type: "other", emoji: "🥤" }

  return null
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ entries: [], totalMl: 0 })
  const userId = session.user.id
  const date = new URL(req.url).searchParams.get("date") ?? new Date().toISOString().split("T")[0]

  try {
    const rows = await prisma.$queryRaw<{ id: string; tagName: string | null; text: string | null; timestamp: Date }[]>`
      SELECT "id", "tagName", "text", "timestamp" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "day" = ${date}
      ORDER BY "timestamp" ASC
    `

    const entries = rows.flatMap(r => {
      // Combine tagName (the drink type, e.g. "Espresso") and text (the
      // user's comment, e.g. "30ml") so that explicit volumes are found
      // even when they live in the separate comment field.
      const combined = [r.tagName, r.text].filter(Boolean).join(" ").trim()
      if (!combined) return []
      const drink = drinkType(combined)
      if (!drink) return []
      const mlMatch = combined.match(ML_RE)
      const amountMl = mlMatch ? parseInt(mlMatch[1]) : defaultMlForType(combined, drink.type)
      // Display name: prefer the tag type name alone (cleaner), but keep
      // full combined label if tagName is absent.
      const name = r.tagName?.trim() || combined
      return [{ id: r.id, name, type: drink.type, emoji: drink.emoji, amountMl, timestamp: r.timestamp }]
    })

    // totalMl is water-only for the weekly water trend chart
    const totalMl = entries
      .filter(e => e.type === "water")
      .reduce((s, e) => s + (e.amountMl ?? 0), 0)

    return NextResponse.json({ entries, totalMl })
  } catch {
    return NextResponse.json({ entries: [], totalMl: 0 })
  }
}
