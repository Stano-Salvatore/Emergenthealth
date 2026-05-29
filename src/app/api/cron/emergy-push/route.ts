import { NextRequest, NextResponse } from "next/server"
import webpush from "web-push"
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

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app"
  if (!publicKey || !privateKey) return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 })

  webpush.setVapidDetails(email, publicKey, privateKey)

  const today = new Date()
  const dayStart = new Date(today.toISOString().split("T")[0] + "T00:00:00Z")

  type SubRow = { userId: string; endpoint: string; p256dh: string; auth: string }
  const subs = await prisma.$queryRaw<SubRow[]>`
    SELECT DISTINCT ON ("userId") "userId", endpoint, p256dh, auth
    FROM "PushSubscription"
    ORDER BY "userId", "createdAt" DESC
  `.catch(() => [] as SubRow[])

  if (!subs.length) return NextResponse.json({ ok: true, sent: 0 })

  const userIds = subs.map(s => s.userId)

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
  await Promise.allSettled(subs.map(async sub => {
    const water = waterByUser.get(sub.userId) ?? 0
    const totalHabits = habitsByUser.get(sub.userId) ?? 0
    const doneHabits = completionsByUser.get(sub.userId) ?? 0
    const habitPct = totalHabits > 0 ? (doneHabits / totalHabits) * 100 : 100

    let message: string | null = null
    if (water < 1500) {
      message = SCREAM_WATER[Math.floor(Date.now() / 86400000) % SCREAM_WATER.length]
    } else if (habitPct < 50) {
      message = SCREAM_HABITS[Math.floor(Date.now() / 86400000) % SCREAM_HABITS.length]
    }
    if (!message) return

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: "Emergy 🌱", body: message, url: "/dashboard" })
      )
      sent++
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 410) {
        await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${sub.endpoint}`.catch(() => {})
      }
    }
  }))

  return NextResponse.json({ ok: true, sent, total: subs.length })
}
