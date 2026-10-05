import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { userToday } from "@/lib/user-timezone"
import { NextResponse } from "next/server"
import { loadWeightSeries } from "@/lib/weight-series"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const url = new URL(req.url)
  const days = parseInt(url.searchParams.get("days") ?? "30", 10)

  // Both weight tables, merged by day (lib/weight-series) — this route only
  // WRITES HealthLog, but the intake overview's "latest weight" read it as
  // if it were the whole record.
  const series = await loadWeightSeries(userId, days)
  return NextResponse.json(series.map(p => ({ date: p.date, weight: p.kg })))
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { weight, date } = await req.json().catch(() => ({}))
  // A body's weight, in kg. Past this it is a typo or a script, and it would
  // sit in the trend line and the correlations as if it were a reading.
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 20 || weight > 400) {
    return NextResponse.json({ error: "weight (kg) between 20 and 400 required" }, { status: 400 })
  }
  if (date != null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
  }

  const dateStr = date ?? await userToday(userId)
  const dateObj = new Date(dateStr + "T00:00:00.000Z")

  const log = await prisma.healthLog.upsert({
    where: { userId_date: { userId, date: dateObj } },
    create: { userId, date: dateObj, weight },
    update: { weight },
    select: { date: true, weight: true },
  })

  return NextResponse.json({ date: log.date.toISOString().split("T")[0], weight: log.weight })
}
