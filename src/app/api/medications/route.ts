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
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "TagAlias" (
      "userId"      TEXT NOT NULL,
      "tagTypeUuid" TEXT NOT NULL,
      "name"        TEXT NOT NULL,
      PRIMARY KEY ("userId", "tagTypeUuid")
    )
  `
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(s: string) { return UUID_RE.test(s.trim()) }

function categorize(label: string): { category: string; emoji: string } {
  const l = label.toLowerCase()

  // Volume amounts (200ml, 300ml …) → Drinks
  if (/\d+\s*ml/.test(l)) return { category: "Drinks", emoji: "🥤" }

  const drinkKeywords = ["coffee", "alcohol", "beer", "wine", "spirit", "cocktail", "drink", "water", "tea",
    "juice", "soda", "energy drink", "protein shake", "shake", "beverage", "smoothie", "latte",
    "espresso", "cappuccino", "whisky", "whiskey", "vodka", "rum", "gin", "cider"]
  const vitaminKeywords = ["vitamin", "vit ", "omega", "zinc", "magnesium", "calcium", "iron", "probiotic",
    "supplement", "fish oil", "d3", "b12", "folate", "biotin", "collagen", "melatonin", "glutamine",
    "creatine", "coq10", "ashwagandha", "turmeric", "curcumin", "quercetin"]
  const medicationKeywords = ["pill", "tablet", "capsule", "medication", "medicine", "drug", "dose", "mg ",
    "ibuprofen", "paracetamol", "aspirin", "antibiotic", "prescription", "painkiller", "antihistamine",
    "inhaler", "injection", "cream", "gel", "spray", "meds", "med ", "rx",
    // common drug name suffixes
    "zepam", "prazole", "mycin", "cillin", "azole", "tidine", "vastatin", "sartan", "pril",
    "olol", "triptan", "setron", "gliptin", "gliflozin", "oxetine", "zepine", "razine",
    "atarax", "elicea", "mirzatem"]

  if (drinkKeywords.some(k => l.includes(k))) return { category: "Drinks", emoji: "🥤" }
  if (vitaminKeywords.some(k => l.includes(k))) return { category: "Vitamins", emoji: "🌿" }
  if (medicationKeywords.some(k => l.includes(k))) return { category: "Medications", emoji: "💊" }
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
    const [rows, aliasRows] = await Promise.all([
      prisma.$queryRaw<
        { id: string; day: string; timestamp: Date; tagName: string | null; text: string | null; tags: string[] }[]
      >`
        SELECT "id","day","timestamp","tagName","text","tags"
        FROM "OuraTag"
        WHERE "userId" = ${userId}
        ORDER BY "timestamp" DESC
        LIMIT 2000
      `,
      prisma.$queryRaw<{ tagTypeUuid: string; name: string }[]>`
        SELECT "tagTypeUuid","name" FROM "TagAlias" WHERE "userId" = ${userId}
      `,
    ])

    // User-defined aliases take highest priority
    const aliasMap = new Map(aliasRows.map(r => [r.tagTypeUuid, r.name]))

    // Build UUID → display name from any entry that has a readable name or comment
    const uuidToName = new Map<string, string>()
    for (const r of rows) {
      const uuid = r.tags[0]
      if (!uuid || uuidToName.has(uuid)) continue
      const readable = [r.tagName, r.text].find(s => s && s.trim() && !isUuid(s.trim()))
      if (readable) uuidToName.set(uuid, readable.trim())
    }

    let items = rows.map(r => {
      // Resolve best display name: user alias → tagName → text → UUID inference
      const resolved =
        (r.tags[0] ? aliasMap.get(r.tags[0]) ?? null : null) ??
        (r.tagName && !isUuid(r.tagName) ? r.tagName : null) ??
        (r.text && r.text.trim() && !isUuid(r.text) ? r.text.trim() : null) ??
        (r.tags[0] ? uuidToName.get(r.tags[0]) ?? null : null)

      const { category: cat, emoji } = categorize(resolved ?? "")
      return { ...r, tagName: resolved, category: cat, emoji }
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
    return NextResponse.json({ items: [], error: "Failed to load tags" })
  }
}
