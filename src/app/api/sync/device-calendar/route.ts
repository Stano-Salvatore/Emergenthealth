import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 60

type DeviceEventPayload = {
  externalId: string
  calendarId: string | null
  title: string
  description: string | null
  location: string | null
  color: string | null
  start: string
  end: string | null
  isAllDay: boolean
}

// Accept only a safe #RGB / #RRGGBB hex so it can go straight into inline styles.
function cleanHex(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return /^#?[0-9a-fA-F]{6}$/.test(s) ? (s.startsWith("#") ? s : `#${s}`) : null
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  let body: {
    from?: string
    to?: string
    events?: DeviceEventPayload[]
    calendars?: { id: string; name: string; color: string | null }[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Store the phone's calendar list (id, name, source colour) so Settings can
  // offer a per-calendar colour picker. Kept as a preference — no schema change.
  if (Array.isArray(body.calendars)) {
    const cals = body.calendars
      .filter((c) => c && c.id != null)
      .map((c) => ({ id: String(c.id), name: String(c.name ?? "Calendar").slice(0, 120), color: cleanHex(c.color) }))
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: "device_calendars" } },
      create: { userId, key: "device_calendars", value: JSON.stringify(cals) },
      update: { value: JSON.stringify(cals) },
    }).catch(() => {})
  }

  const events = Array.isArray(body.events) ? body.events : []

  const clean = events
    .filter((e) => e && e.externalId && e.start && !Number.isNaN(Date.parse(e.start)))
    .map((e) => ({
      externalId: String(e.externalId),
      calendarId: e.calendarId != null ? String(e.calendarId) : null,
      title: (e.title ?? "").toString().slice(0, 500) || "(No title)",
      description: e.description ? String(e.description).slice(0, 5000) : null,
      location: e.location ? String(e.location).slice(0, 500) : null,
      color: cleanHex(e.color),
      start: new Date(e.start),
      end: e.end && !Number.isNaN(Date.parse(e.end)) ? new Date(e.end) : null,
      isAllDay: e.isAllDay === true,
    }))

  await Promise.all(
    clean.map((e) =>
      prisma.deviceCalendarEvent.upsert({
        where: { userId_externalId: { userId, externalId: e.externalId } },
        create: { userId, syncedAt: new Date(), ...e },
        update: { syncedAt: new Date(), ...e },
      }),
    ),
  )

  // Prune events that fell out of the device (deleted / declined) within the
  // synced window, so the stored copy stays in step with the phone.
  const from = body.from && !Number.isNaN(Date.parse(body.from)) ? new Date(body.from) : null
  const to = body.to && !Number.isNaN(Date.parse(body.to)) ? new Date(body.to) : null
  if (from && to) {
    const keep = new Set(clean.map((e) => e.externalId))
    const inWindow = await prisma.deviceCalendarEvent.findMany({
      where: { userId, start: { gte: from, lte: to } },
      select: { externalId: true },
    })
    const stale = inWindow.map((r) => r.externalId).filter((id) => !keep.has(id))
    if (stale.length) {
      await prisma.deviceCalendarEvent.deleteMany({
        where: { userId, externalId: { in: stale } },
      })
    }
  }

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: "device_calendar_last_sync" } },
    create: { userId, key: "device_calendar_last_sync", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  }).catch(() => {})

  return NextResponse.json({ success: true, synced: clean.length })
}
