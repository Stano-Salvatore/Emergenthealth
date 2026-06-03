import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { format, subDays } from "date-fns"

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const since = subDays(new Date(), 14)
  const sinceStr = format(since, "yyyy-MM-dd")
  const todayStr = format(new Date(), "yyyy-MM-dd")

  // Fetch MoodLog entries (the primary mood source)
  const moodLogs = await prisma.moodLog.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "asc" },
    select: { date: true, mood: true },
  })

  // Fetch MorningCheckIn entries for energy data (and mood fallback)
  const checkinRows = await prisma.$queryRaw<{ date: string; mood: number; energy: number }[]>`
    SELECT "date", "mood", "energy" FROM "MorningCheckIn"
    WHERE "userId" = ${userId} AND "date" >= ${sinceStr} AND "date" <= ${todayStr}
    ORDER BY "date" ASC
  `.catch(() => [] as { date: string; mood: number; energy: number }[])

  // Also fetch sleep data for correlation insights
  const healthLogs = await prisma.healthLog.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "asc" },
    select: { date: true, sleepDuration: true },
  })

  // Build a map: date string -> data
  const checkinByDate = new Map(checkinRows.map(c => [c.date, c]))
  const sleepByDate = new Map(
    healthLogs
      .filter(l => l.sleepDuration != null)
      .map(l => [format(l.date, "yyyy-MM-dd"), l.sleepDuration! / 60])
  )

  // Merge: MoodLog is the primary mood source; MorningCheckIn provides energy
  const byDate = new Map<string, { date: string; mood: number; energy: number | null; sleepH: number | null }>()

  for (const ml of moodLogs) {
    const dateStr = format(ml.date, "yyyy-MM-dd")
    const checkin = checkinByDate.get(dateStr)
    byDate.set(dateStr, {
      date: dateStr,
      mood: ml.mood,
      energy: checkin?.energy ?? null,
      sleepH: sleepByDate.get(dateStr) ?? null,
    })
  }

  // Fill in any MorningCheckIn mood on days with no MoodLog entry
  for (const c of checkinRows) {
    if (!byDate.has(c.date)) {
      byDate.set(c.date, {
        date: c.date,
        mood: c.mood,
        energy: c.energy,
        sleepH: sleepByDate.get(c.date) ?? null,
      })
    }
  }

  const logs = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({ logs })
}
