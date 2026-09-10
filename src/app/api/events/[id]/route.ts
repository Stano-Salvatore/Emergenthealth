import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { parseEventInput } from "@/lib/app-events"
import { normalizeRepeat } from "@/lib/recurrence"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const existing = await prisma.appEvent.findFirst({ where: { id, userId: session.user.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const tz = await getUserTimezone(session.user.id)
  const parsed = parseEventInput(body, tz, { ...existing, repeat: normalizeRepeat(existing.repeat) })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // A rewritten rule or start invalidates the per-occurrence exceptions.
  const resetExceptions = body.start !== undefined || body.repeat !== undefined
  const row = await prisma.appEvent.update({
    where: { id },
    data: { ...parsed.data, ...(resetExceptions ? { exceptions: [] } : {}) },
  })
  return NextResponse.json(row)
}

// DELETE — the whole event; with ?occurrence=YYYY-MM-DD, only that day of a
// repeating one (it joins the exceptions list; the rest of the series stays).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const occurrence = req.nextUrl.searchParams.get("occurrence")

  const existing = await prisma.appEvent.findFirst({ where: { id, userId: session.user.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (occurrence && existing.repeat && /^\d{4}-\d{2}-\d{2}$/.test(occurrence)) {
    await prisma.appEvent.update({
      where: { id },
      data: { exceptions: [...new Set([...existing.exceptions, occurrence])] },
    })
    return NextResponse.json({ ok: true, removedOccurrence: occurrence })
  }
  await prisma.appEvent.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
