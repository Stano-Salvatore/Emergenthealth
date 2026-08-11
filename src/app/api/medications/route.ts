import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { normalizeSupplement, cleanLabel, fold } from "@/lib/supplement-normalize"

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
  // Diacritics-insensitive so Slovak labels (káva, horčík, vitamín…) match too
  const l = fold(label)

  // Volume amounts (200ml, 300ml …) → Drinks
  if (/\d+\s*ml/.test(l)) return { category: "Drinks", emoji: "🥤" }

  const drinkKeywords = ["coffee", "alcohol", "beer", "wine", "spirit", "cocktail", "drink", "water", "tea",
    "juice", "soda", "energy drink", "protein shake", "shake", "beverage", "smoothie", "latte",
    "espresso", "cappuccino", "whisky", "whiskey", "vodka", "rum", "gin", "cider", "matcha", "sparkling",
    // Slovak (folded)
    "kava", "pivo", "vino", "voda", "caj", "dzus", "borovicka", "slivovica"]
  const vitaminKeywords = ["vitamin", "vit ", "omega", "zinc", "magnesium", "calcium", "iron", "probiotic",
    "supplement", "fish oil", "d3", "b12", "folate", "biotin", "collagen", "melatonin", "glutamine",
    "creatine", "coq10", "ashwagandha", "turmeric", "curcumin", "quercetin",
    // Slovak (folded)
    "horcik", "zelezo", "vapnik", "zinok", "selen", "kolagen", "kreatin", "kurkuma", "probiotik"]
  const medicationKeywords = ["pill", "tablet", "capsule", "medication", "medicine", "drug", "dose", "mg ",
    "ibuprofen", "paracetamol", "aspirin", "antibiotic", "prescription", "painkiller", "antihistamine",
    "inhaler", "injection", "cream", "gel", "spray", "meds", "med ", "rx",
    // Slovak (folded)
    "liek", "tabletka", "kvapky", "sirup", "mast", "antibiotik",
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
        LIMIT 500
      `,
      prisma.$queryRaw<{ tagTypeUuid: string; name: string }[]>`
        SELECT "tagTypeUuid","name" FROM "TagAlias" WHERE "userId" = ${userId}
      `,
    ])

    // User-defined aliases take highest priority
    const aliasMap = new Map(aliasRows.map(r => [r.tagTypeUuid, r.name]))

    // Build UUID → display name inference from entries that have readable text.
    const uuidToName = new Map<string, string>()
    for (const r of rows) {
      const uuid = r.tags[0]
      const readable = [r.tagName, r.text].find(s => s && s.trim() && !isUuid(s))
      if (uuid && readable && !uuidToName.has(uuid)) {
        uuidToName.set(uuid, readable.trim())
      }
    }

    let items = rows.map(r => {
      // Resolve best display name: user alias → tagName → text → UUID inference
      const resolved =
        (r.tags[0] ? aliasMap.get(r.tags[0]) ?? null : null) ??
        (r.tagName && !isUuid(r.tagName) ? r.tagName : null) ??
        (r.text && r.text.trim() && !isUuid(r.text) ? r.text.trim() : null) ??
        (r.tags[0] ? uuidToName.get(r.tags[0]) ?? null : null)

      // Canonical substance name so "D3", "vit d 2000IU" and "vitamín D" all
      // group as one thing; unrecognized labels are just tidied up.
      const canonical = resolved ? normalizeSupplement(resolved) : null
      const display = canonical ?? (resolved ? cleanLabel(resolved) : null)

      // Every canonical match is a supplement, so it lands in Vitamins even
      // when the raw label carries dosage words that look like medication.
      const { category: cat, emoji } = canonical
        ? { category: "Vitamins", emoji: "🌿" }
        : categorize(resolved ?? "")
      return { ...r, tagName: display, rawName: resolved, category: cat, emoji }
    })

    if (filter) {
      const q = fold(filter)
      items = items.filter(r =>
        (r.tagName && fold(r.tagName).includes(q)) ||
        (r.rawName && fold(r.rawName).includes(q)) ||
        (r.text && fold(r.text).includes(q)) ||
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
