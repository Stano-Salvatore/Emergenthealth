import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPushToUser } from "@/lib/push"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("Authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const users = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT DISTINCT "userId" FROM "PushSubscription"
  `.catch(() => [] as { userId: string }[])

  let sent = 0
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().split("T")[0]

  for (const { userId } of users) {
    try {
      const sleepRows = await prisma.$queryRaw<{ score: number | null }[]>`
        SELECT score FROM "OuraSleep" WHERE "userId" = ${userId} AND date = ${dateStr} LIMIT 1
      `.catch(() => [] as { score: number | null }[])

      const score = sleepRows[0]?.score
      const body = score != null
        ? `Sleep score last night: ${score}. Check your dashboard for today's plan.`
        : "Good morning! Your daily summary is ready."

      await sendPushToUser(userId, {
        title: "Good morning ☀️",
        body,
        url: "/dashboard",
      })
      sent++
    } catch {
      // continue for next user
    }
  }

  return NextResponse.json({ ok: true, sent })
}
