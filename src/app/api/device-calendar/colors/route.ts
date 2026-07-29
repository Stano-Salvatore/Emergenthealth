import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

type CalInfo = { id: string; name: string; color: string | null }

function cleanHex(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return /^#?[0-9a-fA-F]{6}$/.test(s) ? (s.startsWith("#") ? s : `#${s}`) : null
}

async function readJson<T>(userId: string, key: string, fallback: T): Promise<T> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key } },
    select: { value: true },
  }).catch(() => null)
  if (!row?.value) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

// Normalise an event title into a stable key for per-activity colouring.
export function titleKey(t: string): string {
  return t.trim().toLowerCase().slice(0, 120)
}

// Calendars + per-calendar overrides + the user's recurring activity names and
// per-activity overrides (so they can colour by event name, like Samsung).
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const [calendars, overrides, titleOverrides, grouped] = await Promise.all([
    readJson<CalInfo[]>(userId, "device_calendars", []),
    readJson<Record<string, string>>(userId, "device_calendar_overrides", {}),
    readJson<Record<string, string>>(userId, "device_calendar_title_overrides", {}),
    prisma.deviceCalendarEvent.groupBy({
      by: ["title"],
      where: { userId },
      _count: { title: true },
      orderBy: { _count: { title: "desc" } },
      take: 40,
    }).catch(() => [] as { title: string; _count: { title: number } }[]),
  ])

  // Distinct recurring activity names (dedup by normalised key), most frequent first.
  const seen = new Set<string>()
  const titles: string[] = []
  for (const g of grouped) {
    const t = (g.title ?? "").trim()
    if (!t || t === "(No title)") continue
    const k = titleKey(t)
    if (seen.has(k)) continue
    seen.add(k)
    titles.push(t)
    if (titles.length >= 24) break
  }

  return NextResponse.json({ calendars, overrides, titles, titleOverrides })
}

// Set (or clear, with color=null) a colour override — either for a calendar
// ({ calendarId }) or an activity name ({ title }).
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  const hex = cleanHex(body.color)

  if (typeof body.title === "string" && body.title.trim()) {
    const key = titleKey(body.title)
    const map = await readJson<Record<string, string>>(userId, "device_calendar_title_overrides", {})
    if (hex) map[key] = hex
    else delete map[key]
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: "device_calendar_title_overrides" } },
      create: { userId, key: "device_calendar_title_overrides", value: JSON.stringify(map) },
      update: { value: JSON.stringify(map) },
    })
    return NextResponse.json({ ok: true, titleOverrides: map })
  }

  const calendarId = typeof body.calendarId === "string" ? body.calendarId : null
  if (!calendarId) return NextResponse.json({ error: "calendarId or title required" }, { status: 400 })

  const overrides = await readJson<Record<string, string>>(userId, "device_calendar_overrides", {})
  if (hex) overrides[calendarId] = hex
  else delete overrides[calendarId]

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: "device_calendar_overrides" } },
    create: { userId, key: "device_calendar_overrides", value: JSON.stringify(overrides) },
    update: { value: JSON.stringify(overrides) },
  })

  return NextResponse.json({ ok: true, overrides })
}
