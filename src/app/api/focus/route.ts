import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const url = new URL(req.url)
  const days = parseInt(url.searchParams.get("days") ?? "7", 10)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const sessions = await prisma.focusSession.findMany({
    where: { userId, endedAt: { gte: since } },
    orderBy: { endedAt: "desc" },
  })

  return NextResponse.json(sessions)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { durationMin, type, label, startedAt } = await req.json()
  if (!durationMin || typeof durationMin !== "number") {
    return NextResponse.json({ error: "durationMin required" }, { status: 400 })
  }

  const fs = await prisma.focusSession.create({
    data: {
      userId,
      durationMin,
      type: type ?? "focus",
      label: label ?? null,
      startedAt: startedAt ? new Date(startedAt) : new Date(Date.now() - durationMin * 60 * 1000),
    },
  })

  return NextResponse.json(fs, { status: 201 })
}
