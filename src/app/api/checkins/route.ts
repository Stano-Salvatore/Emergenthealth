import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 100)
  const since = searchParams.get("since")

  const checkins = await prisma.checkIn.findMany({
    where: {
      userId: session.user.id,
      ...(since && { checkedAt: { gte: new Date(since) } }),
    },
    orderBy: { checkedAt: "desc" },
    take: limit,
  })

  return NextResponse.json(checkins)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { place, emoji, note } = await req.json()
  if (!place?.trim()) return NextResponse.json({ error: "place required" }, { status: 400 })

  const checkIn = await prisma.checkIn.create({
    data: {
      userId: session.user.id,
      place: place.trim(),
      emoji: emoji ?? "📍",
      note: note ?? null,
    },
  })

  return NextResponse.json(checkIn, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await req.json()
  await prisma.checkIn.deleteMany({ where: { id, userId: session.user.id } })
  return NextResponse.json({ ok: true })
}
