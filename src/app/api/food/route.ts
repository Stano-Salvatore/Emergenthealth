import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { estimateCaffeine } from "@/lib/caffeine"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement } from "@/lib/supplement-normalize"
import { extractMirrorableDrinks } from "@/lib/drink-mirror"
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const url = new URL(req.url)
  const date = url.searchParams.get("date") ?? new Date().toISOString().split("T")[0]

  // ?days=7 returns daily calorie totals for the last N days (for trend charts)
  const days = parseInt(url.searchParams.get("days") ?? "0")
  if (days > 0 && days <= 30) {
    const end = new Date(date + "T23:59:59.999Z")
    const start = new Date(end.getTime() - (days - 1) * 86400000)
    start.setUTCHours(0, 0, 0, 0)
    const logs = await prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: start, lte: end } },
      select: { calories: true, loggedAt: true },
    })
    // loggedAt is a timestamp, so slicing its ISO string groups by UTC day —
    // a late-night meal counted toward the day before.
    const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: await getUserTimezone(userId) })
    const byDay: Record<string, number> = {}
    for (const l of logs) {
      const day = dayFmt.format(l.loggedAt)
      byDay[day] = (byDay[day] ?? 0) + l.calories
    }
    return NextResponse.json(byDay)
  }

  const start = new Date(date + "T00:00:00.000Z")
  const end = new Date(date + "T23:59:59.999Z")
  const [logs, ouraTags] = await Promise.all([
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: start, lte: end } },
      orderBy: { loggedAt: "asc" },
    }),
    // Supplements the user logged in the Oura app that day — shown alongside
    // the food-derived vitamins so "took Vitamin D" and "got Vitamin D from
    // food" land in one place.
    prisma.$queryRaw<{ tagName: string | null; text: string | null }[]>`
      SELECT "tagName","text" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "day" = ${date} ORDER BY "timestamp"
    `.catch(() => []),
  ])

  const supplements: string[] = []
  const seen = new Set<string>()
  for (const t of ouraTags) {
    const label = (t.tagName ?? t.text ?? "").trim()
    if (!label || classifyOuraTag(label).kind !== "med") continue
    const display = normalizeSupplement(label) ?? label
    if (!seen.has(display.toLowerCase())) { seen.add(display.toLowerCase()); supplements.push(display) }
  }

  return NextResponse.json({ logs, supplements })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : ""
  const calories = Number(body?.calories)
  if (!name || !Number.isFinite(calories) || calories < 0 || calories > 10000) {
    return NextResponse.json({ error: "name and calories required" }, { status: 400 })
  }

  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n <= 2000 ? Math.round(n * 10) / 10 : null
  }
  const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack", "other"])

  const log = await prisma.foodLog.create({
    data: {
      userId,
      name,
      mealType: MEAL_TYPES.has(body?.mealType) ? body.mealType : "other",
      calories: Math.round(calories),
      proteinG: num(body?.proteinG),
      carbsG: num(body?.carbsG),
      fatG: num(body?.fatG),
      sugarG: num(body?.sugarG),
      items: Array.isArray(body?.items) ? (body.items.slice(0, 20) as Prisma.InputJsonValue) : undefined,
      micros: Array.isArray(body?.micros) ? (body.micros.slice(0, 8) as Prisma.InputJsonValue) : undefined,
      note: typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null,
      photo: typeof body?.photo === "string" && body.photo.startsWith("data:image/") && body.photo.length < 100_000
        ? body.photo
        : null,
      lat: Number.isFinite(Number(body?.lat)) && Math.abs(Number(body.lat)) <= 90 ? Number(body.lat) : null,
      lng: Number.isFinite(Number(body?.lng)) && Math.abs(Number(body.lng)) <= 180 ? Number(body.lng) : null,
      place: typeof body?.place === "string" && body.place.trim() ? body.place.trim().slice(0, 120) : null,
    },
  })

  // Recognized drinks also feed the drinks tracker (and caffeine, via the same
  // estimator the Intake tab uses). Shared id prefix ties them to this meal so
  // deleting the meal removes them too. Failures are logged, never swallowed —
  // a drink that silently doesn't mirror looks like data loss to the user.
  let mirroredDrinks = 0
  const drinks = extractMirrorableDrinks(body?.items)
  for (const [i, d] of drinks.entries()) {
    const intakeId = `food_${log.id}_${i}`
    const created = await prisma.intakeLog.create({
      data: { id: intakeId, userId, type: d.type, amountMl: d.volumeMl, note: d.name || null },
    }).catch(e => { console.error("food→intake mirror failed", intakeId, e); return null })
    if (!created) continue
    mirroredDrinks++
    const est = estimateCaffeine(d.type, d.name, d.volumeMl)
    if (est) {
      await prisma.caffeineLog.create({
        data: { id: `intake_${intakeId}`, userId, compound: est.compound, caffeineMg: est.mg },
      }).catch(e => console.error("food→caffeine mirror failed", intakeId, e))
    }
  }

  return NextResponse.json({ ...log, mirroredDrinks }, { status: 201 })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null)
  const id = body?.id
  const log = await prisma.foodLog.findUnique({ where: { id: typeof id === "string" ? id : "" } })
  if (!log || log.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const num = (v: unknown, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : undefined
  }
  const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack", "other"])
  const data: Record<string, unknown> = {}
  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 120)
  if (MEAL_TYPES.has(body?.mealType)) data.mealType = body.mealType
  const cal = num(body?.calories, 10000)
  if (cal !== undefined) data.calories = Math.round(cal)
  for (const k of ["proteinG", "carbsG", "fatG", "sugarG"] as const) {
    const v = num(body?.[k], 2000)
    if (v !== undefined) data[k] = v
  }
  if (body?.note !== undefined) data.note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 })
  }

  const updated = await prisma.foodLog.update({ where: { id }, data })
  return NextResponse.json(updated)
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = await req.json()
  const log = await prisma.foodLog.findUnique({ where: { id } })
  if (!log || log.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  await prisma.foodLog.delete({ where: { id } })
  // remove the drink entries (and their caffeine) this meal mirrored into the tracker
  await prisma.intakeLog.deleteMany({ where: { userId, id: { startsWith: `food_${id}_` } } }).catch(() => null)
  await prisma.caffeineLog.deleteMany({ where: { userId, id: { startsWith: `intake_food_${id}_` } } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
