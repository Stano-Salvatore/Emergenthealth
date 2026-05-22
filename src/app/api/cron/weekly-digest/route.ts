import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Resend } from "resend"
import { format, subDays, startOfWeek } from "date-fns"

// Vercel cron jobs send Authorization: Bearer <CRON_SECRET>
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function avg(arr: (number | null | undefined)[]): number | null {
  const vals = arr.filter((v): v is number => v != null)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

function digestHtml(params: {
  name: string
  weekOf: string
  avgSleepH: number | null
  avgHrv: number | null
  avgReadiness: number | null
  totalSteps: number | null
  avgSteps: number | null
  totalSpend: string | null
  habitRate: number | null
}): string {
  const { name, weekOf, avgSleepH, avgHrv, avgReadiness, totalSteps, avgSteps, totalSpend, habitRate } = params

  const metric = (label: string, value: string, color: string) => `
    <div style="background:#1a192a;border-radius:12px;padding:16px 20px;flex:1;min-width:140px;">
      <div style="font-size:11px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${label}</div>
      <div style="font-size:24px;font-weight:700;color:${color};">${value}</div>
    </div>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#09090f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f2f2fa;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#312e81,#4f46e5);border-radius:16px;padding:28px 24px;margin-bottom:24px;text-align:center;">
      <div style="font-size:13px;color:#a5b4fc;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Weekly Digest</div>
      <div style="font-size:26px;font-weight:800;color:#ffffff;">Hey ${name} 👋</div>
      <div style="font-size:14px;color:#c7d2fe;margin-top:6px;">Week of ${weekOf}</div>
    </div>

    <!-- Health metrics -->
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">Health</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${metric("Avg Sleep", avgSleepH != null ? `${avgSleepH}h` : "—", "#818cf8")}
        ${metric("Avg HRV", avgHrv != null ? `${avgHrv}ms` : "—", "#34d399")}
        ${metric("Readiness", avgReadiness != null ? `${avgReadiness}` : "—", "#60a5fa")}
      </div>
    </div>

    <!-- Activity -->
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">Activity</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${metric("Total Steps", totalSteps != null ? totalSteps.toLocaleString() : "—", "#fbbf24")}
        ${metric("Daily Avg", avgSteps != null ? avgSteps.toLocaleString() : "—", "#fb923c")}
      </div>
    </div>

    <!-- Finances -->
    ${totalSpend ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">Finances</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${metric("Total Spent", totalSpend, "#f43f5e")}
      </div>
    </div>` : ""}

    <!-- Habits -->
    ${habitRate != null ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">Habits</div>
      <div style="background:#1a192a;border-radius:12px;padding:16px 20px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="flex:1;height:8px;background:#201f32;border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${habitRate}%;background:linear-gradient(90deg,#6366f1,#a78bfa);border-radius:4px;"></div>
          </div>
          <div style="font-size:18px;font-weight:700;color:#a78bfa;">${habitRate}%</div>
        </div>
        <div style="font-size:12px;color:#7a7a96;margin-top:8px;">Completion rate this week</div>
      </div>
    </div>` : ""}

    <!-- Footer -->
    <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #201f32;">
      <div style="font-size:12px;color:#7a7a96;">Emergenthealth • Your personal health dashboard</div>
    </div>

  </div>
</body>
</html>`
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: true, reason: "RESEND_API_KEY not set" })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekEnd = new Date()
  const weekOf = format(weekStart, "MMMM d, yyyy")

  const users = await prisma.user.findMany({
    where: { email: { not: null } },
    select: { id: true, name: true, email: true },
  })

  const results: { email: string; status: string }[] = []

  for (const user of users) {
    try {
      const [logs, habits, completions] = await Promise.all([
        prisma.healthLog.findMany({
          where: { userId: user.id, date: { gte: weekStart, lte: weekEnd } },
          select: { sleepDuration: true, hrv: true, readinessScore: true, steps: true },
        }),
        prisma.habit.findMany({ where: { userId: user.id, isArchived: false }, select: { id: true } }),
        prisma.habitCompletion.findMany({
          where: { userId: user.id, date: { gte: weekStart, lte: weekEnd } },
          select: { habitId: true },
        }),
      ])

      const transactions = await prisma.transaction.findMany({
        where: { userId: user.id, date: { gte: weekStart, lte: weekEnd }, amount: { lt: 0 } },
        select: { amount: true },
      })

      const totalSpendCents = transactions.reduce((s, t) => s + Math.abs(t.amount), 0)
      const totalSpend = totalSpendCents > 0 ? `€${(totalSpendCents / 100).toFixed(2)}` : null

      const avgSleepMin = avg(logs.map(l => l.sleepDuration))
      const avgSleepH = avgSleepMin != null ? Math.round(avgSleepMin / 60 * 10) / 10 : null
      const avgHrv = avg(logs.map(l => l.hrv))
      const avgReadiness = avg(logs.map(l => l.readinessScore))
      const totalSteps = logs.reduce((s, l) => s + (l.steps ?? 0), 0) || null
      const avgSteps = totalSteps != null && logs.length ? Math.round(totalSteps / logs.length) : null

      const possibleCompletions = habits.length * 7
      const habitRate = possibleCompletions > 0
        ? Math.round((completions.length / possibleCompletions) * 100)
        : null

      const html = digestHtml({
        name: user.name?.split(" ")[0] ?? "there",
        weekOf,
        avgSleepH,
        avgHrv,
        avgReadiness,
        totalSteps,
        avgSteps,
        totalSpend,
        habitRate,
      })

      await resend.emails.send({
        from: "Emergenthealth <onboarding@resend.dev>",
        to: user.email!,
        subject: `Your week in review — ${weekOf}`,
        html,
      })

      results.push({ email: user.email!, status: "sent" })
    } catch (e) {
      results.push({ email: user.email!, status: `error: ${e}` })
    }
  }

  return NextResponse.json({ sent: results.length, results })
}
