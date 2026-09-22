import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { userToday } from "@/lib/user-timezone"
import { addDaysISO } from "@/lib/local-date"
import { loadMoodByDay, moodDay } from "@/lib/mood-series"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const { searchParams } = new URL(req.url)
  // ?date=YYYY-MM-DD answers for one day; ?days=N for the last N days up to
  // and including today — the user's today, not the server's UTC one.
  const today = await userToday(userId)
  const asked = searchParams.get("date")
  const oneDay = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null
  const days = Math.min(parseInt(searchParams.get("days") ?? "30"), 90)
  const fromDay = oneDay ?? addDaysISO(today, -days)
  const toDay = oneDay ?? today

  // Mood lives in two tables and this route read only the one it writes, so
  // the Journal showed a blank row of faces on every day answered in the
  // morning check-in. The merge decides the score; the note is the
  // standalone log's own, since the check-in has none.
  const [byDay, logs] = await Promise.all([
    loadMoodByDay(userId, fromDay, toDay),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: new Date(fromDay + "T00:00:00.000Z"), lte: new Date(toDay + "T23:59:59.999Z") } },
      select: { date: true, mood: true, note: true },
    }).catch(() => []),
  ])
  const notes = new Map(logs.map(l => [moodDay(l.date), l]))
  const out = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, mood]) => ({ date, mood, note: notes.get(date)?.mood === mood ? notes.get(date)!.note : null }))

  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { mood, note, date } = await req.json()
  if (typeof mood !== "number" || mood < 1 || mood > 5) {
    return NextResponse.json({ error: "mood must be 1–5" }, { status: 400 })
  }

  const day = date ?? await userToday(session.user.id)
  const dateObj = new Date(day + "T00:00:00.000Z")

  const log = await prisma.moodLog.upsert({
    where: { userId_date: { userId: session.user.id, date: dateObj } },
    create: { userId: session.user.id, date: dateObj, mood, note: note ?? null },
    update: { mood, note: note ?? null, updatedAt: new Date() },
  })

  return NextResponse.json(log)
}
