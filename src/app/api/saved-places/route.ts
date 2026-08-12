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

const USUAL_TYPES = new Set(["water", "sparkling", "coffee", "tea", "matcha", "beer", "wine", "spirits", "alcohol", "juice", "soda", "milk", "other"])

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const existing = await prisma.savedPlace.findUnique({ where: { id: typeof body?.id === "string" ? body.id : "" } })
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 80)
  if (typeof body.emoji === "string" && body.emoji.trim()) data.emoji = body.emoji.trim().slice(0, 8)
  if (body.radiusM != null) data.radiusM = Math.min(2000, Math.max(20, parseInt(body.radiusM)))
  // the usual: set all three together, or clear with usualType: null
  if (body.usualType === null) {
    data.usualType = null; data.usualMl = null; data.usualNote = null
  } else if (typeof body.usualType === "string" && USUAL_TYPES.has(body.usualType)) {
    const ml = Math.round(Number(body.usualMl))
    if (Number.isFinite(ml) && ml > 0 && ml <= 3000) {
      data.usualType = body.usualType
      data.usualMl = ml
      data.usualNote = typeof body.usualNote === "string" && body.usualNote.trim() ? body.usualNote.trim().slice(0, 60) : null
    }
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 })

  const place = await prisma.savedPlace.update({ where: { id: existing.id }, data })
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
