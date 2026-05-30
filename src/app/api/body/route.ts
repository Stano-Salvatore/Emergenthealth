import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

async function ensurePrefsTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "UserPreference" (
      "userId" TEXT NOT NULL,
      "key"    TEXT NOT NULL,
      "value"  TEXT NOT NULL,
      PRIMARY KEY ("userId", "key"),
      CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
    )
  `
}

async function getHeightCm(userId: string): Promise<number | null> {
  await ensurePrefsTable()
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'body_height_cm'
  `
  if (!rows.length) return null
  const v = parseFloat(rows[0].value)
  return isNaN(v) ? null : v
}

function calcBmi(weightKg: number, heightCm: number): number {
  const h = heightCm / 100
  return Math.round((weightKg / (h * h)) * 10) / 10
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const measurements = await prisma.bodyMeasurement.findMany({
    where: { userId },
    orderBy: { date: "desc" },
  })

  const heightCm = await getHeightCm(userId)

  return NextResponse.json({
    measurements: measurements.map(m => ({
      ...m,
      date: m.date.toISOString().split("T")[0],
      createdAt: m.createdAt.toISOString(),
    })),
    heightCm,
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json()
  const {
    date,
    weightKg,
    waistCm,
    hipsCm,
    chestCm,
    neckCm,
    bodyFatPct,
    musclePct,
    notes,
  } = body

  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 })

  const dateObj = new Date(date + "T00:00:00.000Z")

  let bmi: number | undefined
  if (typeof weightKg === "number") {
    const heightCm = await getHeightCm(userId)
    if (heightCm) bmi = calcBmi(weightKg, heightCm)
  }

  const data = {
    ...(typeof weightKg === "number" && { weightKg }),
    ...(typeof waistCm === "number" && { waistCm }),
    ...(typeof hipsCm === "number" && { hipsCm }),
    ...(typeof chestCm === "number" && { chestCm }),
    ...(typeof neckCm === "number" && { neckCm }),
    ...(typeof bodyFatPct === "number" && { bodyFatPct }),
    ...(typeof musclePct === "number" && { musclePct }),
    ...(bmi !== undefined && { bmi }),
    ...(notes !== undefined && { notes }),
    source: "manual",
  }

  const measurement = await prisma.bodyMeasurement.upsert({
    where: { userId_date: { userId, date: dateObj } },
    create: { userId, date: dateObj, ...data },
    update: data,
  })

  return NextResponse.json({
    ...measurement,
    date: measurement.date.toISOString().split("T")[0],
    createdAt: measurement.createdAt.toISOString(),
  })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await prisma.bodyMeasurement.deleteMany({ where: { id, userId } })
  return NextResponse.json({ ok: true })
}
