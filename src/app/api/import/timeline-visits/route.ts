import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  let body: { visits: Record<string, { start: string; end: string }[]>; summary: Record<string, number> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const TARGETS = {
    home:       { lat: 48.175421976678,  lng: 17.126068557003457, label: "Home (Račianska 95)",           emoji: "🏠" },
    cafe:       { lat: 48.1490416,        lng: 17.1171726,         label: "Kaviareň Vták",                 emoji: "☕" },
    rudo_janka: { lat: 48.395534,         lng: 17.3090072,         label: "Rudo a Janka",                  emoji: "👨‍👩‍👧" },
    parents:    { lat: 48.3965142,        lng: 17.3227352,         label: "Parents (Červený Kameň)",       emoji: "👪" },
    krstna:     { lat: 48.1594238,        lng: 17.1607528,         label: "Krstná (Trebišovská)",          emoji: "🏡" },
    zahrada:    { lat: 48.1829391,        lng: 17.3486593,         label: "Záhrada (Poľná, Nová Dedinka)", emoji: "🌿" },
  }

  const payload = {
    targets: TARGETS,
    visits: body.visits,
    summary: body.summary,
  }

  const value = JSON.stringify(payload)

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: "timeline_visits" } },
    create: { userId, key: "timeline_visits", value },
    update: { value },
  })

  const totalVisits = Object.values(body.summary).reduce((a, b) => a + b, 0)
  return NextResponse.json({ ok: true, totalVisits })
}
