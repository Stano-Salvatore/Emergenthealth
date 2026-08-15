import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 30

// Stores the visits a Timeline import matched to the user's places, for the
// location↔health correlations to run on.
//
// The targets used to be six coordinates hardcoded here, overwriting whatever
// the client matched against — so the import could only ever describe those
// six places, and saving a new place changed nothing. The client sends the
// targets it matched now; these stay only as the fallback for an older client.

interface Target { lat: number; lng: number; label: string; emoji: string }

const LEGACY_TARGETS: Record<string, Target> = {
  home:       { lat: 48.175421976678, lng: 17.126068557003457, label: "Home (Račianska 95)",           emoji: "🏠" },
  cafe:       { lat: 48.1490416,      lng: 17.1171726,         label: "Kaviareň Vták",                 emoji: "☕" },
  rudo_janka: { lat: 48.395534,       lng: 17.3090072,         label: "Rudo a Janka",                  emoji: "👨‍👩‍👧" },
  parents:    { lat: 48.3965142,      lng: 17.3227352,         label: "Parents (Červený Kameň)",       emoji: "👪" },
  krstna:     { lat: 48.1594238,      lng: 17.1607528,         label: "Krstná (Trebišovská)",          emoji: "🏡" },
  zahrada:    { lat: 48.1829391,      lng: 17.3486593,         label: "Záhrada (Poľná, Nová Dedinka)", emoji: "🌿" },
}

const MAX_TARGETS = 60
const MAX_VISITS_PER_TARGET = 5000

function sanitizeTargets(raw: unknown): Record<string, Target> | null {
  if (!raw || typeof raw !== "object") return null
  const out: Record<string, Target> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_TARGETS)) {
    const t = value as Record<string, unknown>
    const lat = Number(t?.lat), lng = Number(t?.lng)
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) continue
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) continue
    out[key.slice(0, 64)] = {
      lat, lng,
      label: typeof t.label === "string" && t.label.trim() ? t.label.trim().slice(0, 80) : key,
      emoji: typeof t.emoji === "string" && t.emoji ? t.emoji.slice(0, 8) : "📍",
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  let body: {
    visits?: Record<string, { start: string; end: string }[]>
    summary?: Record<string, number>
    targets?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const targets = sanitizeTargets(body.targets) ?? LEGACY_TARGETS

  // Only visits belonging to a known target are stored — an unknown key would
  // render as a nameless series in the correlations.
  const visits: Record<string, { start: string; end: string }[]> = {}
  for (const key of Object.keys(targets)) {
    const list = Array.isArray(body.visits?.[key]) ? body.visits[key] : []
    visits[key] = list
      .filter(v => typeof v?.start === "string" && typeof v?.end === "string")
      .slice(0, MAX_VISITS_PER_TARGET)
      .map(v => ({ start: v.start, end: v.end }))
  }

  const summary: Record<string, number> = {}
  for (const [key, list] of Object.entries(visits)) summary[key] = list.length

  const value = JSON.stringify({ targets, visits, summary })

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: "timeline_visits" } },
    create: { userId, key: "timeline_visits", value },
    update: { value },
  })

  const totalVisits = Object.values(summary).reduce((a, b) => a + b, 0)
  return NextResponse.json({ ok: true, totalVisits, targets: Object.keys(targets).length })
}
