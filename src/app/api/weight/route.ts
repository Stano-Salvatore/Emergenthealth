import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const url = new URL(req.url)
  const days = parseInt(url.searchParams.get("days") ?? "30", 10)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const logs = await prisma.healthLog.findMany({
    where: { userId, date: { gte: since }, weight: { not: null } },
    orderBy: { date: "asc" },
    select: { date: true, weight: true },
  })

  return NextResponse.json(logs.map(l => ({
    date: l.date.toISOString().split("T")[0],
    weight: l.weight,
  })))
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { weight, date } = await req.json()
  if (!weight || typeof weight !== "number") {
    return NextResponse.json({ error: "weight (kg) required" }, { status: 400 })
  }

  const dateStr = date ?? new Date().toISOString().split("T")[0]
  const dateObj = new Date(dateStr + "T00:00:00.000Z")

  const log = await prisma.healthLog.upsert({
    where: { userId_date: { userId, date: dateObj } },
    create: { userId, date: dateObj, weight },
    update: { weight },
    select: { date: true, weight: true },
  })

  return NextResponse.json({ date: log.date.toISOString().split("T")[0], weight: log.weight })
}
