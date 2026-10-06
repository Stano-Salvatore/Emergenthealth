import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { appleHealthKeyUser, hashKey } from "@/lib/apple-health-key"
import { readAppleHealthDay } from "@/lib/apple-health"
import { phoneFieldsRespectingRing, PRECEDENCE_SELECT } from "@/lib/health-precedence"
import { checkRateLimit } from "@/lib/rate-limit"
import { userToday } from "@/lib/user-timezone"

export const runtime = "nodejs"

// Where the iPhone Shortcut posts Apple Health data (lib/apple-health reads
// it). The shortcut has no session; it carries the account's key as
// "Authorization: Bearer ah_…". The answer is read by a person testing the
// shortcut, so a refusal says what to change.

const MAX_BODY = 200_000

export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || null
  const who = await appleHealthKeyUser(bearer)
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status })
  const userId = who.userId

  // A shortcut runs a few times a day; this is room for testing, not a flood.
  if (!checkRateLimit(hashKey(bearer!), "apple_health_sync", 60, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: "Too many runs this hour." }, { status: 429 })
  }

  const text = await req.text()
  if (text.length > MAX_BODY) return NextResponse.json({ error: "That's more than a day's numbers." }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(text) } catch { body = null }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected JSON — set Request Body to JSON in Get Contents of URL." }, { status: 400 })
  }

  const { date, fields, ignored } = readAppleHealthDay(body as Record<string, unknown>, await userToday(userId))
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({
      error: ignored.includes("sleep")
        ? "Nothing readable arrived. Sleep times must be formatted as ISO 8601 (tap the variable → Date Format → ISO 8601)."
        : "Nothing readable arrived — no values, or only zeros (the watch may not have synced yet).",
      received: Object.keys(body as object),
      ignored,
    }, { status: 422 })
  }

  const day = new Date(`${date}T00:00:00.000Z`)
  // The ring wins where it speaks (lib/health-precedence), as for Health Connect.
  const existing = await prisma.healthLog.findUnique({
    where: { userId_date: { userId, date: day } },
    select: PRECEDENCE_SELECT,
  })
  const allowed = phoneFieldsRespectingRing(existing, fields)
  const syncedAt = new Date()
  await prisma.healthLog.upsert({
    where: { userId_date: { userId, date: day } },
    create: { userId, date: day, ...fields, syncedAt },
    update: { ...allowed, syncedAt },
  })

  const saved = Object.fromEntries(
    Object.entries(allowed).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
  )
  const kept = Object.keys(fields).filter(k => !(k in allowed))
  await Promise.all([
    prisma.appleHealthKey.update({ where: { userId }, data: { lastUsedAt: syncedAt } }).catch(() => null),
    prisma.userPreference.upsert({
      where: { userId_key: { userId, key: "apple_health_last_sync" } },
      create: { userId, key: "apple_health_last_sync", value: JSON.stringify({ at: syncedAt.toISOString(), date, saved, kept, ignored }) },
      update: { value: JSON.stringify({ at: syncedAt.toISOString(), date, saved, kept, ignored }) },
    }).catch(() => null),
  ])

  return NextResponse.json({ ok: true, date, saved, keptFromRing: kept, ignored })
}
