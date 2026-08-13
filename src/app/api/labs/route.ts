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

  const body = await req.json()

  // Bulk save from a document import. Re-importing the same report — easy to
  // do when you're not sure the first attempt worked — must not double every
  // row, so an identical marker/date/value already on file is skipped rather
  // than added again.
  if (Array.isArray(body?.results)) {
    const date = typeof body.date === "string" ? body.date : null
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 })
    }
    const when = new Date(date + "T00:00:00.000Z")

    type Row = { marker?: unknown; value?: unknown; unit?: unknown; referenceMin?: unknown; referenceMax?: unknown; notes?: unknown }
    const rows = (body.results as Row[])
      .map(r => ({
        marker: typeof r.marker === "string" ? r.marker.trim().slice(0, 80) : "",
        value: typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null,
        unit: typeof r.unit === "string" ? r.unit.trim().slice(0, 20) : "",
        referenceMin: typeof r.referenceMin === "number" && Number.isFinite(r.referenceMin) ? r.referenceMin : null,
        referenceMax: typeof r.referenceMax === "number" && Number.isFinite(r.referenceMax) ? r.referenceMax : null,
        notes: typeof r.notes === "string" && r.notes.trim() ? r.notes.trim().slice(0, 200) : null,
      }))
      .filter(r => r.marker && r.value !== null)
      .slice(0, 100)

    if (rows.length === 0) return NextResponse.json({ error: "no usable rows" }, { status: 400 })

    const existing = await prisma.labResult.findMany({
      where: { userId, date: when, marker: { in: rows.map(r => r.marker) } },
      select: { marker: true, value: true },
    })
    const seen = new Set(existing.map(e => `${e.marker}|${e.value}`))
    const fresh = rows.filter(r => !seen.has(`${r.marker}|${r.value}`))

    if (fresh.length > 0) {
      await prisma.labResult.createMany({
        data: fresh.map(r => ({ ...r, value: r.value as number, userId, date: when })),
      })
    }

    return NextResponse.json({ ok: true, saved: fresh.length, skipped: rows.length - fresh.length }, { status: 201 })
  }

  const { marker, value, unit, referenceMin, referenceMax, date, notes } = body
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
