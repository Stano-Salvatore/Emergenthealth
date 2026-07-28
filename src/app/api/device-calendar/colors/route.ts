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

// The phone's calendars + the user's per-calendar colour overrides.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const [calendars, overrides] = await Promise.all([
    readJson<CalInfo[]>(userId, "device_calendars", []),
    readJson<Record<string, string>>(userId, "device_calendar_overrides", {}),
  ])
  return NextResponse.json({ calendars, overrides })
}

// Set (or clear, with color=null) the colour override for one calendar.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  const calendarId = typeof body.calendarId === "string" ? body.calendarId : null
  if (!calendarId) return NextResponse.json({ error: "calendarId required" }, { status: 400 })

  const overrides = await readJson<Record<string, string>>(userId, "device_calendar_overrides", {})
  const hex = cleanHex(body.color)
  if (hex) overrides[calendarId] = hex
  else delete overrides[calendarId]

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: "device_calendar_overrides" } },
    create: { userId, key: "device_calendar_overrides", value: JSON.stringify(overrides) },
    update: { value: JSON.stringify(overrides) },
  })

  return NextResponse.json({ ok: true, overrides })
}
