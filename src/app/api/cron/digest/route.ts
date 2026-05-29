import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendDigestForUser } from "@/lib/digest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const now = new Date()
  const currentDay = now.getUTCDay()
  const currentHour = now.getUTCHours()

  const users = await prisma.user.findMany({
    where: { digestDay: currentDay, digestHour: currentHour, email: { not: null } },
    select: { id: true, email: true },
  })

  if (!users.length) return NextResponse.json({ ok: true, sent: 0 })

  const results = await Promise.allSettled(
    users.map(u => sendDigestForUser(u.id, u.email!))
  )

  const sent = results.filter(r => r.status === "fulfilled").length
  return NextResponse.json({ ok: true, sent, total: users.length })
}
