import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

// Goals are stored as a JSON blob in a simple table row per user
// We use DailyNote with date='0001-01-01' as a workaround until a proper Goals table is added
const GOALS_KEY = "0001-01-01"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  try {
    const row = await prisma.dailyNote.findUnique({
      where: { userId_date: { userId, date: new Date(GOALS_KEY) } },
    })
    if (!row) return NextResponse.json(defaultGoals())
    return NextResponse.json(JSON.parse(row.content))
  } catch {
    return NextResponse.json(defaultGoals())
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const goals = await req.json()

  await prisma.dailyNote.upsert({
    where: { userId_date: { userId, date: new Date(GOALS_KEY) } },
    create: { userId, date: new Date(GOALS_KEY), content: JSON.stringify(goals) },
    update: { content: JSON.stringify(goals) },
  })

  return NextResponse.json({ ok: true })
}

function defaultGoals() {
  return {
    sleepH: 7.5,
    steps: 8000,
    waterMl: 2000,
    focusMin: 90,
    habitsTarget: 100,
    weightKg: null,
    readinessMin: 70,
    coffeeMax: 400,
  }
}
