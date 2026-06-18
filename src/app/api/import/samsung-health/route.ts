import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 60

function parseLine(line: string): string[] {
  const result: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
    } else if (c === "," && !inQuotes) {
      result.push(field.trim())
      field = ""
    } else {
      field += c
    }
  }
  result.push(field.trim())
  return result
}

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseLine(lines[0]).map(h => h.trim())
  return lines.slice(1).map(line => {
    const values = parseLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]))
  })
}

function num(s: string | undefined): number | null {
  if (!s || s === "") return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function int(s: string | undefined): number | null {
  const n = num(s)
  return n != null ? Math.round(n) : null
}

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
    // Mood CSV: date, time, mood_type, emotions
    // mood_type: 1=Terrible, 2=Bad, 3=Neutral, 4=Good, 5=Amazing — same as app's 1-5
    let imported = 0
    for (const row of rows) {
      if (!row.date || !row.mood_type) continue
      const mood = int(row.mood_type)
      if (!mood || mood < 1 || mood > 5) continue
      const date = new Date(row.date + "T00:00:00.000Z")
      await prisma.moodLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, mood },
        update: {},
      }).catch(() => {})
      imported++
    }
    return NextResponse.json({ imported, type: "mood" })
  }

  // Combined CSV: date, sleep_score, sleep_efficiency, physical_recovery,
  // mental_recovery, sleep_duration_min, steps, distance_m, calories,
  // avg_stress, stress_readings, avg_hr, min_hr, max_hr, weight_kg
  let imported = 0
  const upserts = rows
    .filter(row => row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .map(row => {
      const date = new Date(row.date + "T00:00:00.000Z")

      const sleepScore   = int(row.sleep_score)
      const sleepEff     = int(row.sleep_efficiency)
      const sleepDur     = int(row.sleep_duration_min)
      const steps        = int(row.steps)
      const distanceKm   = row.distance_m ? Math.round((parseFloat(row.distance_m) / 1000) * 100) / 100 : null
      const calories     = int(row.calories)
      const avgHr        = int(row.avg_hr)
      const weightKg     = num(row.weight_kg)

      const fields = {
        ...(sleepScore != null    && { sleepScore }),
        ...(sleepEff != null      && { sleepEfficiency: sleepEff }),
        ...(sleepDur != null      && sleepDur > 0 && { sleepDuration: sleepDur }),
        ...(steps != null         && steps > 0 && { steps }),
        ...(distanceKm != null    && distanceKm > 0 && { distanceKm }),
        ...(calories != null      && calories > 0 && { caloriesBurned: calories }),
        ...(avgHr != null         && avgHr > 0 && avgHr < 250 && { restingHR: avgHr }),
        ...(weightKg != null      && weightKg > 0 && { weight: Math.round(weightKg * 10) / 10 }),
        syncedAt: new Date(),
      }

      if (Object.keys(fields).length <= 1) return null
      imported++

      return prisma.healthLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...fields },
        update: fields,
      })
    })
    .filter((u): u is NonNullable<typeof u> => u != null)

  await Promise.all(upserts)

  return NextResponse.json({ imported, type: "combined" })
}
