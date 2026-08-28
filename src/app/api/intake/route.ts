import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { estimateCaffeine } from "@/lib/caffeine"
import { NextResponse } from "next/server"
import { hydrationMl, HYDRATING_TYPES } from "@/lib/hydration"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const url = new URL(req.url)
  const date = url.searchParams.get("date") ?? new Date().toISOString().split("T")[0]

  // ?days=7 returns daily water totals for the last N days (for trend charts)
  const days = parseInt(url.searchParams.get("days") ?? "0")
  if (days > 0 && days <= 30) {
    const end = new Date(date + "T23:59:59.999Z")
    const start = new Date(end.getTime() - (days - 1) * 86400000)
    start.setUTCHours(0, 0, 0, 0)
    const logs = await prisma.intakeLog.findMany({
      where: { userId, type: { in: HYDRATING_TYPES }, loggedAt: { gte: start, lte: end } },
      select: { amountMl: true, loggedAt: true, type: true },
    })
    // Grouped by the user's day, not the server's: loggedAt is a timestamp, so
    // slicing its ISO string put a late-night drink on the day before.
    const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: await getUserTimezone(userId) })
    const byDay: Record<string, number> = {}
    for (const l of logs) {
      const day = dayFmt.format(l.loggedAt)
      byDay[day] = (byDay[day] ?? 0) + hydrationMl(l.type, l.amountMl)
    }
    return NextResponse.json(byDay)
  }

  const start = new Date(date + "T00:00:00.000Z")
  const end = new Date(date + "T23:59:59.999Z")

  const logs = await prisma.intakeLog.findMany({
    where: { userId, loggedAt: { gte: start, lte: end } },
    orderBy: { loggedAt: "asc" },
  })

  return NextResponse.json(logs)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { type, amountMl, note } = await req.json()
  if (!type || !amountMl || typeof amountMl !== "number") {
    return NextResponse.json({ error: "type and amountMl required" }, { status: 400 })
  }

  const log = await prisma.intakeLog.create({
    data: { userId, type, amountMl, note: note ?? null },
  })

  // Caffeinated drinks feed the caffeine tracker automatically. The shared id
  // ties the two entries together so deleting the drink removes its caffeine.
  const est = estimateCaffeine(type, note ?? "", amountMl)
  if (est) {
    await prisma.caffeineLog.create({
      data: { id: `intake_${log.id}`, userId, compound: est.compound, caffeineMg: est.mg },
    }).catch(() => null)
  }

  return NextResponse.json(log, { status: 201 })
}

const EDIT_TYPES = new Set(["water", "sparkling", "coffee", "tea", "matcha", "beer", "wine", "spirits", "alcohol", "juice", "soda", "milk", "other"])

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id, type, amountMl, note } = await req.json()
  const log = await prisma.intakeLog.findUnique({ where: { id } })
  if (!log || log.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  // Oura-mirrored entries revert on the next sync — they're edited in the Oura app.
  if (id.startsWith("oura_")) {
    return NextResponse.json({ error: "Edit this entry in the Oura app" }, { status: 400 })
  }

  const data: { type?: string; amountMl?: number; note?: string | null } = {}
  if (typeof type === "string" && EDIT_TYPES.has(type)) data.type = type
  const ml = Math.round(Number(amountMl))
  if (Number.isFinite(ml) && ml > 0 && ml <= 10000) data.amountMl = ml
  if (note !== undefined) data.note = typeof note === "string" && note.trim() ? note.trim().slice(0, 80) : null
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 })
  }

  const updated = await prisma.intakeLog.update({ where: { id }, data })

  // Re-sync the linked caffeine entry: the type or amount may have changed
  // what (if any) caffeine this drink carries. Keep the original time so the
  // decay curve stays honest.
  await prisma.caffeineLog.deleteMany({ where: { id: `intake_${id}`, userId } }).catch(() => null)
  const est = estimateCaffeine(updated.type, updated.note ?? "", updated.amountMl)
  if (est) {
    await prisma.caffeineLog.create({
      data: { id: `intake_${id}`, userId, compound: est.compound, caffeineMg: est.mg, loggedAt: updated.loggedAt },
    }).catch(() => null)
  }

  return NextResponse.json(updated)
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = await req.json()
  const log = await prisma.intakeLog.findUnique({ where: { id } })
  if (!log || log.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.intakeLog.delete({ where: { id } })
  // remove the auto-logged caffeine that came with this drink, if any
  await prisma.caffeineLog.deleteMany({ where: { id: `intake_${id}`, userId } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
