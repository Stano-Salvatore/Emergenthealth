import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { estimateCaffeine } from "@/lib/caffeine"
import { userDay } from "@/lib/user-timezone"

async function resolveUser(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? ""
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : new URL(req.url).searchParams.get("key") ?? ""
  if (!key) return null
  const apiKey = await prisma.mcpApiKey.findUnique({ where: { token: key } }).catch(() => null)
  return apiKey?.userId ?? null
}

export async function GET(req: NextRequest) {
  const userId = await resolveUser(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { start: today } = await userDay(userId)

  const logs = await prisma.intakeLog.findMany({
    where: { userId, loggedAt: { gte: today } },
    select: { type: true, amountMl: true },
  })

  const totals: Record<string, number> = {}
  for (const l of logs) {
    totals[l.type] = (totals[l.type] ?? 0) + l.amountMl
  }

  return NextResponse.json({ totals, date: today.toISOString().split("T")[0] })
}

export async function POST(req: NextRequest) {
  const userId = await resolveUser(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { type, amountMl, note } = await req.json()
  if (!type || typeof amountMl !== "number") {
    return NextResponse.json({ error: "type and amountMl required" }, { status: 400 })
  }

  const log = await prisma.intakeLog.create({
    data: { userId, type, amountMl, note: note ?? null },
  })

  // caffeinated drinks auto-feed the caffeine tracker (same as /api/intake)
  const est = estimateCaffeine(type, note ?? "", amountMl)
  if (est) {
    await prisma.caffeineLog.create({
      data: { id: `intake_${log.id}`, userId, compound: est.compound, caffeineMg: est.mg },
    }).catch(() => null)
  }

  return NextResponse.json(log, { status: 201 })
}
