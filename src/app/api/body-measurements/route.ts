import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })


  const rows = await prisma.$queryRaw<{
    id: string
    userId: string
    loggedAt: Date
    waistCm: number | null
    chestCm: number | null
    hipsCm: number | null
    neckCm: number | null
    bicepCm: number | null
    bodyFatPct: number | null
    notes: string | null
  }[]>`
    SELECT * FROM "BodyMeasurementLog"
    WHERE "userId" = ${session.user.id}
    ORDER BY "loggedAt" DESC
    LIMIT 30
  `

  return NextResponse.json({ measurements: rows })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    waistCm?: unknown
    chestCm?: unknown
    hipsCm?: unknown
    neckCm?: unknown
    bicepCm?: unknown
    bodyFatPct?: unknown
    notes?: unknown
    loggedAt?: unknown
  }

  const waistCm    = body.waistCm    != null ? Number(body.waistCm)    : null
  const chestCm    = body.chestCm    != null ? Number(body.chestCm)    : null
  const hipsCm     = body.hipsCm     != null ? Number(body.hipsCm)     : null
  const neckCm     = body.neckCm     != null ? Number(body.neckCm)     : null
  const bicepCm    = body.bicepCm    != null ? Number(body.bicepCm)    : null
  const bodyFatPct = body.bodyFatPct != null ? Number(body.bodyFatPct) : null
  const notes      = typeof body.notes === "string" ? body.notes.trim() || null : null
  const logTime    = body.loggedAt   ? new Date(body.loggedAt as string) : new Date()

  const hasValue = [waistCm, chestCm, hipsCm, neckCm, bicepCm, bodyFatPct].some(v => v !== null && !isNaN(v))
  if (!hasValue) {
    return NextResponse.json({ error: "At least one measurement field is required" }, { status: 400 })
  }


  const id = `bml_${session.user.id}_${Date.now()}`

  await prisma.$executeRaw`
    INSERT INTO "BodyMeasurementLog"
      ("id", "userId", "loggedAt", "waistCm", "chestCm", "hipsCm", "neckCm", "bicepCm", "bodyFatPct", "notes")
    VALUES
      (${id}, ${session.user.id}, ${logTime}, ${waistCm}, ${chestCm}, ${hipsCm}, ${neckCm}, ${bicepCm}, ${bodyFatPct}, ${notes})
  `

  return NextResponse.json({ ok: true, id })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const searchParams = new URL(req.url).searchParams
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })


  await prisma.$executeRaw`
    DELETE FROM "BodyMeasurementLog"
    WHERE "id" = ${id} AND "userId" = ${session.user.id}
  `

  return NextResponse.json({ ok: true })
}
