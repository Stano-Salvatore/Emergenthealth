import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const results = await prisma.labResult.findMany({
    where: { userId },
    orderBy: { date: "desc" },
  })

  const grouped: Record<string, typeof results> = {}
  for (const r of results) {
    if (!grouped[r.marker]) grouped[r.marker] = []
    grouped[r.marker].push(r)
  }

  return NextResponse.json(grouped)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { marker, value, unit, referenceMin, referenceMax, date, notes } = await req.json()
  if (!marker || typeof value !== "number" || !unit || !date) {
    return NextResponse.json({ error: "marker, value, unit, date required" }, { status: 400 })
  }

  const result = await prisma.labResult.create({
    data: {
      userId,
      marker,
      value,
      unit,
      referenceMin: referenceMin ?? null,
      referenceMax: referenceMax ?? null,
      date: new Date(date + "T00:00:00.000Z"),
      notes: notes ?? null,
    },
  })

  return NextResponse.json(result, { status: 201 })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const existing = await prisma.labResult.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.labResult.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
