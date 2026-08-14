import { NextRequest, NextResponse } from "next/server"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SCREAM_WATER = [
  "PLEASE DRINK WATER I AM BEGGING YOU 💧💧💧",
  "I HAVEN'T SEEN YOU DRINK ANYTHING TODAY AND I AM WILTING",
  "WATER. NOW. YOUR PLANT IS DYING 🌵",
]
const SCREAM_HABITS = [
  "YOUR HABITS ARE SUFFERING AND SO AM I 😭",
  "WE HAVEN'T DONE OUR HABITS YET... IT IS ALMOST TOO LATE",
  "COMPLETE YOUR HABITS OR I WILL DROP ALL MY LEAVES",
]

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const hour = new Date().getUTCHours()
  if (hour !== 15) return NextResponse.json({ ok: true, skipped: true, hour })

  if (!configurePush()) return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 })

  const today = new Date()
  const dayStart = new Date(today.toISOString().split("T")[0] + "T00:00:00Z")

  const subsByUser = await loadSubscriptionsByUser()
  if (subsByUser.size === 0) return NextResponse.json({ ok: true, sent: 0 })

  const userIds = [...subsByUser.keys()]

  const [intakes, habits, completions] = await Promise.all([
    prisma.intakeLog.findMany({
      where: { userId: { in: userIds }, type: "water", loggedAt: { gte: dayStart } },
      select: { userId: true, amountMl: true },
    }),
    prisma.habit.findMany({
      where: { userId: { in: userIds }, isArchived: false },
      select: { userId: true, id: true },
    }),
    prisma.habitCompletion.findMany({
      where: { userId: { in: userIds }, completedAt: { gte: dayStart } },
      select: { userId: true },
    }).catch(() => [] as { userId: string }[]),
  ])

  const waterByUser = new Map<string, number>()
  for (const i of intakes) waterByUser.set(i.userId, (waterByUser.get(i.userId) ?? 0) + i.amountMl)

  const habitsByUser = new Map<string, number>()
  for (const h of habits) habitsByUser.set(h.userId, (habitsByUser.get(h.userId) ?? 0) + 1)

  const completionsByUser = new Map<string, number>()
  for (const c of completions) completionsByUser.set(c.userId, (completionsByUser.get(c.userId) ?? 0) + 1)

  let sent = 0
  await Promise.allSettled([...subsByUser].map(async ([userId, subs]) => {
    const water = waterByUser.get(userId) ?? 0
    const totalHabits = habitsByUser.get(userId) ?? 0
    const doneHabits = completionsByUser.get(userId) ?? 0
    const habitPct = totalHabits > 0 ? (doneHabits / totalHabits) * 100 : 100

    let message: string | null = null
    let tag = "emergy"
    let url = "/dashboard"
    if (water < 1500) {
      message = SCREAM_WATER[Math.floor(Date.now() / 86400000) % SCREAM_WATER.length]
      tag = "water"; url = "/dashboard/intake"
    } else if (habitPct < 50) {
      message = SCREAM_HABITS[Math.floor(Date.now() / 86400000) % SCREAM_HABITS.length]
      tag = "habit"; url = "/dashboard/habits"
    }
    if (!message) return

    const delivered = await sendToUser(subs, {
      title: "Emergy 🌱",
      body: message,
      url,
      tag,
      requireInteraction: habitPct < 50,
    })
    if (delivered) sent++
  }))

  return NextResponse.json({ ok: true, sent, total: subsByUser.size })
}
