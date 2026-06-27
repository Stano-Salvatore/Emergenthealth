import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Create a custom timeline event
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  const label = typeof body.label === "string" ? body.label.trim() : ""
  if (!label) return NextResponse.json({ error: "Label required" }, { status: 400 })

  const emoji = typeof body.emoji === "string" && body.emoji.trim() ? body.emoji.trim().slice(0, 8) : "📌"
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null

  // Optional compressed photo (base64 data URL). Cap at ~1.5MB to avoid bloating rows.
  let imageData: string | null = null
  if (typeof body.imageData === "string" && body.imageData.startsWith("data:image/")) {
    imageData = body.imageData.length <= 1_500_000 ? body.imageData : null
  }

  // occurredAt comes as an ISO string; default to now if missing/invalid
  let occurredAt = new Date()
  if (typeof body.occurredAt === "string") {
    const d = new Date(body.occurredAt)
    if (!isNaN(d.getTime())) occurredAt = d
  }

  const event = await prisma.timelineEvent.create({
    data: { userId, emoji, label: label.slice(0, 120), note: note?.slice(0, 500) ?? null, imageData, occurredAt },
    select: { id: true, emoji: true, label: true, note: true, imageData: true, occurredAt: true },
  })

  return NextResponse.json({
    ...event,
    occurredAt: event.occurredAt.toISOString(),
  })
}

// Delete a custom timeline event
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  // deleteMany scopes the delete to the owner — avoids deleting another user's row
  const res = await prisma.timelineEvent.deleteMany({ where: { id, userId } })
  if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ ok: true })
}
