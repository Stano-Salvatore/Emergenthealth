import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  parseCsv, combinedFields, importFieldsOverExisting, moodByDay, ISO_DAY, IMPORT_SELECT,
} from "@/lib/samsung-health-import"

export const runtime = "nodejs"
export const maxDuration = 60

// Small enough that one slow write cannot hold the rest past maxDuration,
// large enough that a year of days is a handful of round trips.
const CHUNK = 25

const COMBINED_COLUMNS = "date (YYYY-MM-DD), sleep_score, sleep_efficiency, sleep_duration_min, steps, distance_m, calories, weight_kg"
const MOOD_COLUMNS = "date (YYYY-MM-DD), time, mood_type (1–5)"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  let body: { type: "combined" | "mood"; csv: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rows = parseCsv(body.csv)
  if (!rows.length) return NextResponse.json({ error: "No data parsed" }, { status: 400 })

  if (body.type === "mood") {
    const days = moodByDay(rows)
    if (days.size === 0) {
      return NextResponse.json({ error: `No row had a usable date and mood. Expected columns: ${MOOD_COLUMNS}.` }, { status: 400 })
    }
    // A day already in MoodLog is the user's own entry and stays; one
    // statement, so the count is exactly the rows it created.
    const { count } = await prisma.moodLog.createMany({
      data: [...days].map(([day, mood]) => ({ userId, date: new Date(day + "T00:00:00.000Z"), mood })),
      skipDuplicates: true,
    })
    return NextResponse.json({ imported: count, unchanged: days.size - count, failed: 0, type: "mood" })
  }

  const usable = rows
    .filter(row => row.date && ISO_DAY.test(row.date))
    .map(row => ({ day: row.date, fields: combinedFields(row) }))
    .filter(r => Object.keys(r.fields).length > 0)
  if (usable.length === 0) {
    return NextResponse.json({ error: `No row had a usable date and value. Expected columns: ${COMBINED_COLUMNS}.` }, { status: 400 })
  }

  // The ring wins where it speaks, and an import fills only what is empty.
  const existingRows = await prisma.healthLog.findMany({
    where: { userId, date: { in: usable.map(r => new Date(r.day + "T00:00:00.000Z")) } },
    select: { date: true, ...IMPORT_SELECT },
  })
  const existingByDay = new Map(existingRows.map(r => [r.date.toISOString().slice(0, 10), r]))

  let imported = 0
  let unchanged = 0
  let failed = 0
  const writes: (() => Promise<unknown>)[] = []
  for (const { day, fields } of usable) {
    const allowed = importFieldsOverExisting(existingByDay.get(day) ?? null, fields)
    if (Object.keys(allowed).length === 0) { unchanged++; continue }
    const date = new Date(day + "T00:00:00.000Z")
    const syncedAt = new Date()
    writes.push(() => prisma.healthLog.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...allowed, syncedAt },
      update: { ...allowed, syncedAt },
    }))
  }
  for (let i = 0; i < writes.length; i += CHUNK) {
    const results = await Promise.allSettled(writes.slice(i, i + CHUNK).map(w => w()))
    for (const r of results) {
      if (r.status === "fulfilled") imported++
      else { failed++; console.error("[import/samsung-health] row failed:", r.reason) }
    }
  }

  return NextResponse.json({ imported, unchanged, failed, type: "combined" })
}
