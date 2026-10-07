import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { appleHealthKeyUser, hashKey } from "@/lib/apple-health-key"
import { readAppleHealthDay } from "@/lib/apple-health"
import { phoneFieldsRespectingRing, PRECEDENCE_SELECT } from "@/lib/health-precedence"
import { checkRateLimit } from "@/lib/rate-limit"
import { ingestLocationPoints } from "@/lib/location-ingest"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr } from "@/lib/local-date"

export const runtime = "nodejs"

// Where the iPhone Shortcut posts Apple Health data (lib/apple-health reads
// it). The shortcut has no session; it carries the account's key as
// "Authorization: Bearer ah_…". The answer is read by a person testing the
// shortcut, so a refusal says what to change.

const MAX_BODY = 200_000

const ISO_HINT = "Sleep times must be formatted as ISO 8601 with the time: tap each sleep variable → Date Format → ISO 8601, and turn on Include ISO 8601 Time."
const ACCESS_HINT = "If the Health app holds data, Shortcuts may not be allowed to read it: Health app → your profile → Apps → Shortcuts → Turn On All."

/** A run that saved nothing leaves its reason where the settings card can show it — Shortcuts doesn't show a refusal. */
async function noteFailure(userId: string, error: string, ignored: string[] = []) {
  const value = JSON.stringify({ at: new Date().toISOString(), error, ignored })
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: "apple_health_last_error" } },
    create: { userId, key: "apple_health_last_error", value },
    update: { value },
  }).catch(() => null)
}

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
    const error = "Expected JSON — set Request Body to JSON in Get Contents of URL."
    await noteFailure(userId, error)
    return NextResponse.json({ error }, { status: 400 })
  }

  const timeZone = await getUserTimezone(userId)
  const read = readAppleHealthDay(body as Record<string, unknown>, localDateStr(timeZone), timeZone)
  const { date, ignored, location } = read
  let fields = read.fields
  const kept: string[] = []

  // Apple's HRV is SDNN; the ring's, and the column's, is RMSSD. With a ring
  // connected, Apple's would fill the days the ring was off with a different
  // measure on the same chart — so it stays out.
  if (fields.hrv !== undefined && await prisma.ouraToken.findUnique({ where: { userId }, select: { userId: true } }).catch(() => null)) {
    const { hrv: _sdnn, ...rest } = fields
    void _sdnn
    fields = rest
    kept.push("hrv")
  }

  if (Object.keys(fields).length === 0 && kept.length === 0 && !location) {
    const error = ignored.includes("sleep")
      ? `Nothing readable arrived. ${ISO_HINT}`
      : `Nothing readable arrived — no values, or only zeros. The watch may not have synced yet. ${ACCESS_HINT}`
    await noteFailure(userId, error, ignored)
    return NextResponse.json({ error, received: Object.keys(body as object), ignored }, { status: 422 })
  }

  const day = new Date(`${date}T00:00:00.000Z`)
  // The ring wins where it speaks (lib/health-precedence), as for Health Connect.
  const syncedAt = new Date()
  let allowed: Partial<typeof fields> = {}
  // Nothing left to write (only an HRV held back above) makes no row.
  if (Object.keys(fields).length > 0) {
    const existing = await prisma.healthLog.findUnique({
      where: { userId_date: { userId, date: day } },
      select: PRECEDENCE_SELECT,
    })
    allowed = phoneFieldsRespectingRing(existing, fields)
    await prisma.healthLog.upsert({
      where: { userId_date: { userId, date: day } },
      create: { userId, date: day, ...fields, syncedAt },
      update: { ...allowed, syncedAt },
    })
  }

  const saved = Object.fromEntries(
    Object.entries(allowed).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
  )
  kept.push(...Object.keys(fields).filter(k => !(k in allowed)))

  // The phone's position as this run saw it, stored as the phone's own
  // tracking stores it — the same rows, ids and visit detection — since on an
  // iPhone this is the only location the app gets.
  let located = false
  if (location) {
    const res = await ingestLocationPoints(userId, [{ lat: location.lat, lng: location.lng, trackedAt: syncedAt.toISOString() }])
      .catch(() => ({ inserted: 0 }))
    located = res.inserted > 0
  }

  const status = JSON.stringify({ at: syncedAt.toISOString(), date, saved, kept, ignored, location: located })
  await Promise.all([
    prisma.appleHealthKey.update({ where: { userId }, data: { lastUsedAt: syncedAt } }).catch(() => null),
    prisma.userPreference.upsert({
      where: { userId_key: { userId, key: "apple_health_last_sync" } },
      create: { userId, key: "apple_health_last_sync", value: status },
      update: { value: status },
    }).catch(() => null),
    prisma.userPreference.deleteMany({ where: { userId, key: { in: ["apple_health_last_error"] } } }).catch(() => null),
  ])

  return NextResponse.json({ ok: true, date, saved, location: located, keptFromRing: kept, ignored })
}
