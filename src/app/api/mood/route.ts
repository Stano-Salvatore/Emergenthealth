import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = Math.min(parseInt(searchParams.get("days") ?? "30"), 90)
  const since = new Date()
  since.setDate(since.getDate() - days)

  const logs = await prisma.moodLog.findMany({
    where: { userId: session.user.id, date: { gte: since } },
    orderBy: { date: "desc" },
  })

  return NextResponse.json(logs)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { mood, note, date } = await req.json()
  if (typeof mood !== "number" || mood < 1 || mood > 5) {
    return NextResponse.json({ error: "mood must be 1–5" }, { status: 400 })
  }

  const dateObj = date ? new Date(date + "T00:00:00.000Z") : new Date(new Date().toISOString().split("T")[0] + "T00:00:00.000Z")

  const log = await prisma.moodLog.upsert({
    where: { userId_date: { userId: session.user.id, date: dateObj } },
    create: { userId: session.user.id, date: dateObj, mood, note: note ?? null },
    update: { mood, note: note ?? null, updatedAt: new Date() },
  })

  return NextResponse.json(log)
}
