import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const places = await prisma.savedPlace.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(places)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { name, emoji, address, lat, lng, radiusM } = body

  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 })
  if (lat == null || lng == null) return NextResponse.json({ error: "lat and lng required" }, { status: 400 })

  const place = await prisma.savedPlace.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      emoji: emoji ?? "📍",
      address: address ?? null,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      radiusM: radiusM ? Math.min(2000, Math.max(20, parseInt(radiusM))) : 100,
    },
  })

  return NextResponse.json(place)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await prisma.savedPlace.deleteMany({
    where: { id, userId: session.user.id },
  })

  return NextResponse.json({ ok: true })
}
