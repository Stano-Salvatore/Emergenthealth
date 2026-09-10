import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { loadEventOccurrences, parseEventInput } from "@/lib/app-events"

export const dynamic = "force-dynamic"

// GET ?from=ISO&to=ISO (default: now → +14 days) — occurrences in the window.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const p = req.nextUrl.searchParams
  const from = p.get("from") ? new Date(p.get("from")!) : new Date()
  const to = p.get("to") ? new Date(p.get("to")!) : new Date(from.getTime() + 14 * 86_400_000)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return NextResponse.json({ error: "bad range" }, { status: 400 })
  }
  if (to.getTime() - from.getTime() > 400 * 86_400_000) return NextResponse.json({ error: "range too wide" }, { status: 400 })

  const tz = await getUserTimezone(userId)
  return NextResponse.json(await loadEventOccurrences(userId, from, to, tz), { headers: { "Cache-Control": "no-store" } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const tz = await getUserTimezone(session.user.id)
  const parsed = parseEventInput(body, tz)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const row = await prisma.appEvent.create({ data: { userId: session.user.id, ...parsed.data } })
  return NextResponse.json(row, { status: 201 })
}
