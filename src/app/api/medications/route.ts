import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { normalizeSupplement, cleanLabel, fold } from "@/lib/supplement-normalize"
import { localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { randomUUID } from "crypto"
import { parseDose } from "@/lib/dose"

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
    "atarax", "hydroxyzin", "elicea", "escitalopram", "mirzaten", "mirzatem", "mirtazapin",
    "frontin", "alprazolam", "xanax", "neurol", "ibalgin", "paralen", "zodac", "nolpaza"]

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
    const [rows, aliasRows] = await Promise.all([
      prisma.$queryRaw<
        { id: string; day: string; timestamp: Date; tagName: string | null; text: string | null; tags: string[]; doseAmount: number | null; doseUnit: string | null }[]
      >`
        SELECT "id","day","timestamp","tagName","text","tags","doseAmount","doseUnit"
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

// ── Manual dose logging ──────────────────────────────────────────────────────
//
// Until now a medication could only exist in this app by being tagged in the
// Oura app: /api/medications was read-only and the sync was the sole writer.
// That makes the whole pharmacology and correlation layer hostage to a ring
// and its OAuth scope. Manual doses are written into the same OuraTag table so
// they flow through every existing consumer — this page, the supplement
// correlations, Emergy's context, XP — with a "manual" marker and an id prefix
// that can't collide with Oura's own ids (the sync only ever upserts by its
// own id, so these are never touched).

const MAX_MINUTES_AGO = 48 * 60

/** Exact taken-at time from the client: must parse, not sit in the future
 *  (beyond clock skew), and not reach back further than a week. */
function parseTakenAt(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const now = Date.now()
  if (d.getTime() > now + 5 * 60_000) return null
  if (d.getTime() < now - 7 * 86400_000) return null
  return d
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { name?: unknown; minutesAgo?: unknown; takenAt?: unknown; note?: unknown; doseAmount?: unknown; doseUnit?: unknown } | null
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : ""
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 })

  const rawMinutes = Number(body?.minutesAgo ?? 0)
  const minutesAgo = Number.isFinite(rawMinutes) ? Math.min(MAX_MINUTES_AGO, Math.max(0, Math.round(rawMinutes))) : 0
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null

  // An explicit dose from the form wins; otherwise read one off the label, so
  // "Atarax - half" and "Atarax 12.5 mg" both record a real quantity even when
  // typed straight into the name box.
  const explicitAmount = Number(body?.doseAmount)
  const explicitUnit = body?.doseUnit === "mg" || body?.doseUnit === "tablet" ? body.doseUnit : null
  const dose = Number.isFinite(explicitAmount) && explicitAmount > 0 && explicitUnit
    ? { amount: Math.min(100_000, explicitAmount), unit: explicitUnit }
    : parseDose(name) ?? (note ? parseDose(note) : null)

  // An exact time beats the "N minutes ago" presets when both arrive. Doses
  // feed the half-life math and the med→sleep correlations, so a dose taken
  // at 8:15 but logged at 14:00 should say 8:15 — and a takenAt the server
  // can't honor must fail loudly, not silently become "now".
  const wantsExact = typeof body?.takenAt === "string" && body.takenAt.length > 0
  const exact = wantsExact ? parseTakenAt(body?.takenAt) : null
  if (wantsExact && !exact) {
    return NextResponse.json({ error: "takenAt must be a valid time, not in the future, within the last week" }, { status: 400 })
  }
  const timestamp = exact ?? new Date(Date.now() - minutesAgo * 60_000)
  // The day this belongs to is the user's day, not the server's — a 00:30 dose
  // in Bratislava is still "today" for them and yesterday for UTC.
  const tz = await getUserTimezone(userId)
  const day = localDateStr(tz, timestamp)

  const id = `manual_${randomUUID()}`
  await prisma.$executeRaw`
    INSERT INTO "OuraTag" ("id","userId","day","timestamp","tagName","text","tags","doseAmount","doseUnit")
    VALUES (${id}, ${userId}, ${day}, ${timestamp}, ${name}, ${note}, ARRAY['manual']::text[], ${dose?.amount ?? null}, ${dose?.unit ?? null})
  `

  return NextResponse.json({ ok: true, id, name, day, timestamp: timestamp.toISOString(), dose })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as
    { id?: unknown; takenAt?: unknown; doseAmount?: unknown; doseUnit?: unknown } | null
  const id = typeof body?.id === "string" ? body.id : ""
  if (!id.startsWith("manual_")) {
    return NextResponse.json({ error: "Only manually logged doses can be edited" }, { status: 400 })
  }

  // A dose edit and a time edit arrive separately; either alone is valid.
  const wantsDose = body?.doseAmount !== undefined
  if (wantsDose) {
    const raw = Number(body?.doseAmount)
    const unit = body?.doseUnit === "mg" || body?.doseUnit === "tablet" ? body.doseUnit : null
    // null clears a dose recorded by mistake — back to "unknown", which is
    // honest, rather than to zero, which would claim they took nothing.
    const clearing = body?.doseAmount === null
    if (!clearing && (!Number.isFinite(raw) || raw <= 0 || !unit)) {
      return NextResponse.json({ error: "A dose needs a positive amount and a unit." }, { status: 400 })
    }
    const updatedDose = await prisma.$executeRaw`
      UPDATE "OuraTag"
      SET "doseAmount" = ${clearing ? null : Math.min(100_000, raw)},
          "doseUnit"   = ${clearing ? null : unit}
      WHERE "id" = ${id} AND "userId" = ${userId}
    `
    if (updatedDose === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json({ ok: true, id })
  }

  // Unlike logging (7-day window), an edit may touch any old entry — the
  // client keeps the time on the entry's own day, so only "not in the
  // future" needs enforcing here.
  const takenAtRaw = typeof body?.takenAt === "string" ? new Date(body.takenAt) : null
  const takenAt = takenAtRaw && !Number.isNaN(takenAtRaw.getTime()) && takenAtRaw.getTime() <= Date.now() + 5 * 60_000
    ? takenAtRaw : null
  if (!takenAt) return NextResponse.json({ error: "takenAt must be a valid time, not in the future" }, { status: 400 })

  const tz = await getUserTimezone(userId)
  const day = localDateStr(tz, takenAt)
  const updated = await prisma.$executeRaw`
    UPDATE "OuraTag" SET "timestamp" = ${takenAt}, "day" = ${day}
    WHERE "id" = ${id} AND "userId" = ${userId}
  `
  if (updated === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ ok: true, id, day, timestamp: takenAt.toISOString() })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = new URL(req.url).searchParams.get("id") ?? ""
  // Only manually logged doses are deletable: an Oura-sourced tag would simply
  // come back on the next sync, so removing it here would be a lie.
  if (!id.startsWith("manual_")) {
    return NextResponse.json({ error: "Only manually logged doses can be deleted" }, { status: 400 })
  }

  await prisma.$executeRaw`DELETE FROM "OuraTag" WHERE "id" = ${id} AND "userId" = ${session.user.id}`
  return NextResponse.json({ ok: true })
}
