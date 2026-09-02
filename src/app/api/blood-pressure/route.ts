import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })


  const rows = await prisma.$queryRaw<{
    id: string
    userId: string
    systolic: number
    diastolic: number
    pulse: number | null
    loggedAt: Date
    notes: string | null
  }[]>`
    SELECT * FROM "BloodPressureLog"
    WHERE "userId" = ${session.user.id}
    ORDER BY "loggedAt" DESC
    LIMIT 30
  `

  return NextResponse.json({ readings: rows })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { systolic, diastolic, pulse, notes, loggedAt } = body

  if (!systolic || !diastolic) {
    return NextResponse.json({ error: "systolic and diastolic are required" }, { status: 400 })
  }

  const sys = Number(systolic)
  const dia = Number(diastolic)
  if (isNaN(sys) || isNaN(dia) || sys < 50 || sys > 300 || dia < 30 || dia > 200) {
    return NextResponse.json({ error: "Invalid blood pressure values" }, { status: 400 })
  }


  const id = `bp_${session.user.id}_${Date.now()}`
  const logTime = loggedAt ? new Date(loggedAt) : new Date()
  const pul = pulse ? Number(pulse) : null
  const nt = notes?.trim() || null

  await prisma.$executeRaw`
    INSERT INTO "BloodPressureLog" ("id", "userId", "systolic", "diastolic", "pulse", "loggedAt", "notes")
    VALUES (${id}, ${session.user.id}, ${sys}, ${dia}, ${pul}, ${logTime}, ${nt})
  `

  return NextResponse.json({ ok: true, id })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })


  await prisma.$executeRaw`
    DELETE FROM "BloodPressureLog"
    WHERE "id" = ${id} AND "userId" = ${session.user.id}
  `

  return NextResponse.json({ ok: true })
}
