import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "OuraTag" (
      "id"        TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "day"       TEXT NOT NULL,
      "timestamp" TIMESTAMPTZ NOT NULL,
      "tagName"   TEXT,
      "text"      TEXT,
      "tags"      TEXT[] NOT NULL DEFAULT '{}'
    )
  `
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OuraTag_userId_day_idx" ON "OuraTag"("userId","day")`
  await prisma.$executeRaw`ALTER TABLE "OuraTag" ADD COLUMN IF NOT EXISTS "tagName" TEXT`
}

function categorize(tagName: string | null, tags: string[]): { category: string; emoji: string } {
  const label = (tagName ?? tags.join(" ")).toLowerCase()

  const drinkKeywords = ["coffee", "alcohol", "beer", "wine", "spirit", "cocktail", "drink", "water", "tea", "juice", "soda", "energy drink", "protein shake", "shake"]
  const vitaminKeywords = ["vitamin", "vit ", "omega", "zinc", "magnesium", "calcium", "iron", "probiotic", "supplement", "fish oil", "d3", "b12", "folate", "biotin", "collagen", "melatonin"]
  const medicationKeywords = ["pill", "tablet", "capsule", "medication", "medicine", "drug", "dose", "mg ", "ibuprofen", "paracetamol", "aspirin", "antibiotic", "prescription", "painkiller", "antihistamine", "inhaler", "injection", "cream", "gel", "spray"]

  if (drinkKeywords.some(k => label.includes(k))) return { category: "Drinks", emoji: "🥤" }
  if (vitaminKeywords.some(k => label.includes(k))) return { category: "Vitamins", emoji: "🌿" }
  if (medicationKeywords.some(k => label.includes(k))) return { category: "Medications", emoji: "💊" }
  return { category: "General", emoji: "🏷️" }
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const filter = searchParams.get("filter") ?? ""
  const category = searchParams.get("category") ?? ""

  try {
    await ensureTable()
    const rows = await prisma.$queryRaw<
      { id: string; day: string; timestamp: Date; tagName: string | null; text: string | null; tags: string[] }[]
    >`
      SELECT "id","day","timestamp","tagName","text","tags"
      FROM "OuraTag"
      WHERE "userId" = ${userId}
      ORDER BY "timestamp" DESC
      LIMIT 500
    `

    let items = rows.map(r => {
      const { category: cat, emoji } = categorize(r.tagName, r.tags)
      return { ...r, category: cat, emoji }
    })

    if (filter) {
      const q = filter.toLowerCase()
      items = items.filter(r =>
        r.tagName?.toLowerCase().includes(q) ||
        r.text?.toLowerCase().includes(q) ||
        r.tags.some(t => t.toLowerCase().includes(q))
      )
    }

    if (category) {
      items = items.filter(r => r.category === category)
    }

    return NextResponse.json({ items })
  } catch (e) {
    console.error("[medications] GET error:", e)
    return NextResponse.json({ items: [], error: String(e) })
  }
}
