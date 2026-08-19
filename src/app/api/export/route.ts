import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest } from "next/server"
import { buildExportBundle } from "@/lib/export"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // dumping every table can outlive the default budget

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
    // Full account backup. Tables are discovered from information_schema in
    // lib/export (every table with a userId column, credentials excluded), so
    // new features join the backup automatically — the previous hand-kept list
    // had quietly drifted and was missing food logs, custom trackers,
    // symptoms, med schedules and goals.
    const bundle = await buildExportBundle(userId)
    return new Response(bundle.json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${bundle.filename}"`,
        "Cache-Control": "no-store",
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
