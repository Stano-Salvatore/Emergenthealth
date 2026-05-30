import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000)

  const habits = await prisma.habit.findMany({
    where: { userId, isArchived: false },
    include: {
      completions: {
        where: { date: { gte: sixtyDaysAgo } },
        orderBy: { date: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  const todayStr = new Date().toISOString().split("T")[0]

  const habitsData = habits.map(habit => {
    const completionDates = new Set(
      habit.completions.map(c => new Date(c.date).toISOString().split("T")[0])
    )
    const completedToday = completionDates.has(todayStr)

    // Current streak (back from today or yesterday)
    let streak = 0
    const sc = new Date()
    if (!completedToday) sc.setDate(sc.getDate() - 1)
    while (completionDates.has(sc.toISOString().split("T")[0])) {
      streak++
      sc.setDate(sc.getDate() - 1)
    }

    // Consecutive missed days (back from yesterday)
    let missedDays = 0
    const mc = new Date()
    mc.setDate(mc.getDate() - 1)
    while (!completionDates.has(mc.toISOString().split("T")[0]) && missedDays < 10) {
      missedDays++
      mc.setDate(mc.getDate() - 1)
    }

    return { id: habit.id, name: habit.name, icon: habit.icon, color: habit.color, streak, completedToday, missedDays }
  })

  // Plant choices and decorations from UserPreference (raw SQL for consistency)
  const prefs = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT "key", "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" LIKE 'garden:%'
  `

  const plantChoices: Record<string, string> = {}
  let decorations: string[] = []
  for (const p of prefs) {
    if (p.key.startsWith("garden:plant:")) plantChoices[p.key.slice(13)] = p.value
    else if (p.key === "garden:decorations") { try { decorations = JSON.parse(p.value) } catch {} }
  }

  // Weather (Open-Meteo, cached 30 min)
  let weather: { code: number; temp: number } | null = null
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=48.1486&longitude=17.1077&current=temperature_2m,weathercode&forecast_days=1&timezone=Europe%2FBratislava",
      { signal: AbortSignal.timeout(3000), next: { revalidate: 1800 } }
    ).catch(() => null)
    if (res?.ok) {
      const d = await res.json()
      weather = { code: d.current?.weathercode ?? 0, temp: Math.round(d.current?.temperature_2m ?? 15) }
    }
  } catch {}

  return NextResponse.json({ habits: habitsData, plantChoices, decorations, weather })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const body = await req.json()

  if (body.habitId && body.plantType) {
    const key = `garden:plant:${body.habitId}`
    const value = String(body.plantType)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, ${key}, ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
    return NextResponse.json({ ok: true })
  }

  if (Array.isArray(body.decorations)) {
    const value = JSON.stringify(body.decorations)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'garden:decorations', ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Invalid body" }, { status: 400 })
}
