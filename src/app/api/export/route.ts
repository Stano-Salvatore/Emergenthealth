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

  // Transactions CSV (a formatted power-user reporting export) stays a Pro
  // perk. The full JSON backup below is not gated behind any plan — it's
  // about never losing your own data, not a premium convenience feature.
  if (type === "transactions" && format !== "json") {
    const { getUserPlan } = await import("@/lib/plan")
    const plan = await getUserPlan(userId)
    if (plan !== "pro") {
      return new Response(JSON.stringify({ error: "Transactions export is a Pro feature. Upgrade at /pricing." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    }
  }

  if (type === "all" || format === "json") {
    // Full account backup as JSON. Every personal-data table the user can
    // see in the app, so this is a genuine "everything" export — auth
    // tokens, sessions, passkeys and other secrets are deliberately excluded.
    const [
      profile, health, transactions, habits, completions, reminders, mood, tags,
      checkIns, savedPlaces, notes, intake, books, screenTime, timeline, focus,
      chatMessages, ouraTags, morningCheckIns, weatherLogs, caffeineLogs,
      labResults, bodyMeasurements, habitRoutines, locationPoints, stravaActivities,
      feedbacks,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, createdAt: true, digestDay: true, digestHour: true },
      }),
      prisma.healthLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.transaction.findMany({ where: { userId }, orderBy: { date: "desc" } }),
      prisma.habit.findMany({ where: { userId } }),
      prisma.habitCompletion.findMany({ where: { userId }, orderBy: { date: "desc" } }),
      prisma.reminder.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.moodLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.tag.findMany({ where: { userId } }),
      prisma.checkIn.findMany({ where: { userId }, orderBy: { checkedAt: "asc" } }),
      prisma.savedPlace.findMany({ where: { userId } }),
      prisma.dailyNote.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.intakeLog.findMany({ where: { userId }, orderBy: { loggedAt: "asc" } }),
      prisma.book.findMany({ where: { userId } }),
      prisma.screenTimeLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.timelineEvent.findMany({ where: { userId }, orderBy: { occurredAt: "asc" } }),
      prisma.focusSession.findMany({ where: { userId }, orderBy: { endedAt: "asc" } }),
      prisma.chatMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, take: 5000 }),
      prisma.ouraTag.findMany({ where: { userId } }),
      prisma.morningCheckIn.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.weatherLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.caffeineLog.findMany({ where: { userId }, orderBy: { loggedAt: "asc" } }),
      prisma.labResult.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.habitRoutine.findMany({ where: { userId } }),
      prisma.locationPoint.findMany({ where: { userId }, orderBy: { trackedAt: "asc" }, take: 50000 }),
      prisma.stravaActivity.findMany({ where: { userId }, orderBy: { startDate: "asc" } }),
      prisma.userFeedback.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    ])

    const payload = {
      exportedAt: new Date().toISOString(),
      format: "emergenthealth-export-v1",
      userId,
      profile,
      data: {
        health, transactions, habits, completions, reminders, mood, tags,
        checkIns, savedPlaces, notes, intake, books, screenTime, timeline, focus,
        chatMessages, ouraTags, morningCheckIns, weatherLogs, caffeineLogs,
        labResults, bodyMeasurements, habitRoutines, locationPoints, stravaActivities,
        feedbacks,
      },
    }

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="emergenthealth-backup-${new Date().toISOString().split("T")[0]}.json"`,
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
