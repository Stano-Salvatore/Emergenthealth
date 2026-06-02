import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest } from "next/server"

function cell(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString().split("T")[0]
  return String(value)
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ""
  const headers = Object.keys(rows[0])
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map(h => {
      const v = cell(row[h])
      return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
    }).join(","))
  }
  return lines.join("\r\n") + "\r\n"
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 })
  const userId = session.user.id

  const format = new URL(req.url).searchParams.get("format") ?? "csv"
  const type = new URL(req.url).searchParams.get("type") ?? "health"

  if (type === "all" || format === "json") {
    // Full data export as JSON
    const [health, mood, habits, completions, intake, notes, transactions, books, focus] = await Promise.all([
      prisma.healthLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.moodLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.habit.findMany({ where: { userId } }),
      prisma.habitCompletion.findMany({ where: { userId }, orderBy: { date: "desc" } }),
      prisma.intakeLog.findMany({ where: { userId }, orderBy: { loggedAt: "desc" } }),
      prisma.dailyNote.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.transaction.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 1000 }),
      prisma.book.findMany({ where: { userId } }),
      prisma.focusSession.findMany({ where: { userId }, orderBy: { endedAt: "desc" } }),
    ])

    const payload = {
      exportedAt: new Date().toISOString(),
      userId,
      data: { health, mood, habits, completions, intake, notes, transactions, books, focus },
    }

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="emergenthealth-export-${new Date().toISOString().split("T")[0]}.json"`,
      },
    })
  }

  // CSV exports by type
  if (type === "mood") {
    const rows = await prisma.moodLog.findMany({ where: { userId }, orderBy: { date: "asc" } })
    return new Response(toCSV(rows.map(r => ({ date: r.date, mood: r.mood, note: r.note ?? "" }))), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="mood-export.csv"',
      },
    })
  }

  if (type === "intake") {
    const rows = await prisma.intakeLog.findMany({ where: { userId }, orderBy: { loggedAt: "asc" } })
    return new Response(toCSV(rows.map(r => ({ date: r.loggedAt.toISOString(), type: r.type, amountMl: r.amountMl, note: r.note ?? "" }))), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="intake-export.csv"',
      },
    })
  }

  if (type === "habits") {
    const completions = await prisma.habitCompletion.findMany({
      where: { userId },
      include: { habit: { select: { name: true } } },
      orderBy: { date: "desc" },
    })
    return new Response(toCSV(completions.map(c => ({ date: c.date, habit: c.habit.name, completedAt: c.completedAt }))), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="habits-export.csv"',
      },
    })
  }

  if (type === "transactions") {
    const rows = await prisma.transaction.findMany({ where: { userId }, orderBy: { date: "desc" } })
    return new Response(toCSV(rows.map(r => ({
      date: r.date,
      amount: r.amount / 100,
      payee: r.payee ?? "",
      category: r.category ?? "",
      notes: r.notes ?? "",
    }))), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="transactions-export.csv"',
      },
    })
  }

  // Default: health logs
  const logs = await prisma.healthLog.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: {
      date: true, sleepDuration: true, deepSleep: true, remSleep: true, lightSleep: true,
      steps: true, restingHR: true, hrv: true, readinessScore: true, sleepScore: true,
      activityScore: true, spo2: true, caloriesBurned: true, activeMinutes: true,
      distanceKm: true, stressHigh: true, recoveryHigh: true,
    },
  })

  return new Response(toCSV(logs.map(l => ({ ...l, date: l.date instanceof Date ? l.date.toISOString().split("T")[0] : l.date }))), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="health-export.csv"',
    },
  })
}
