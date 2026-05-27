import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Resend } from "resend"
import { format, subDays, startOfWeek } from "date-fns"
import Anthropic from "@anthropic-ai/sdk"

// Vercel cron jobs send Authorization: Bearer <CRON_SECRET>
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface DigestSections {
  sleep: boolean
  steps: boolean
  hrv: boolean
  habits: boolean
  mood: boolean
  focus: boolean
  weight: boolean
  strava: boolean
  github: boolean
  spending: boolean
  lastfm: boolean
}

interface DigestPrefs {
  sections: DigestSections
  thresholds: { minDays: number }
}

const defaultPrefs: DigestPrefs = {
  sections: {
    sleep: true,
    steps: true,
    hrv: true,
    habits: true,
    mood: true,
    focus: true,
    weight: true,
    strava: true,
    github: true,
    spending: true,
    lastfm: true,
  },
  thresholds: { minDays: 3 },
}

function avg(arr: (number | null | undefined)[]): number | null {
  const vals = arr.filter((v): v is number => v != null)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

async function generateNarrative(params: {
  name: string
  avgSleepH: number | null
  avgHrv: number | null
  avgReadiness: number | null
  totalSteps: number | null
  habitRate: number | null
}): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return ""
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const { name, avgSleepH, avgHrv, avgReadiness, totalSteps, habitRate } = params
    const data = [
      avgSleepH     != null ? `avg sleep ${avgSleepH}h/night`      : null,
      avgHrv        != null ? `avg HRV ${avgHrv}ms`                : null,
      avgReadiness  != null ? `avg readiness score ${avgReadiness}` : null,
      totalSteps    != null ? `${totalSteps.toLocaleString()} total steps` : null,
      habitRate     != null ? `${habitRate}% habit completion`      : null,
    ].filter(Boolean).join(", ")

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      system: "You write friendly, personal 2-sentence weekly health summaries. Be specific, warm, and motivating. No emojis. No markdown. Just plain prose.",
      messages: [{ role: "user", content: `Write a 2-sentence summary of ${name}'s health week: ${data || "no data recorded"}.` }],
    })
    const block = msg.content[0]
    return block.type === "text" ? block.text.trim() : ""
  } catch {
    return ""
  }
}

function digestHtml(params: {
  name: string
  weekOf: string
  aiNarrative: string
  avgSleepH: number | null
  avgHrv: number | null
  avgReadiness: number | null
  totalSteps: number | null
  avgSteps: number | null
  totalSpend: string | null
  habitRate: number | null
  prefs: DigestPrefs
}): string {
  const { name, weekOf, aiNarrative, avgSleepH, avgHrv, avgReadiness, totalSteps, avgSteps, totalSpend, habitRate, prefs } = params

  const metric = (label: string, value: string, color: string) => `
    <div style="background:#1a192a;border-radius:12px;padding:16px 20px;flex:1;min-width:140px;">
      <div style="font-size:11px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${label}</div>
      <div style="font-size:24px;font-weight:700;color:${color};">${value}</div>
    </div>`

  const showSleep = prefs.sections.sleep && avgSleepH != null
  const showHrv = prefs.sections.hrv && avgHrv != null
  const showReadiness = avgReadiness != null
  const showHealthSection = showSleep || showHrv || showReadiness

  const showSteps = prefs.sections.steps && totalSteps != null
  const showActivitySection = showSteps

  const showSpending = prefs.sections.spending && !!totalSpend
  const showHabits = prefs.sections.habits && habitRate != null

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

    <!-- AI narrative -->
    ${aiNarrative ? `
    <div style="background:#13122b;border:1px solid #312e81;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
      <div style="font-size:12px;color:#818cf8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">✦ AI Summary</div>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#e0e0f0;">${aiNarrative}</p>
    </div>` : ""}

    <!-- Health metrics -->
    ${showHealthSection ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">Health</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${showSleep ? metric("Avg Sleep", `${avgSleepH}h`, "#818cf8") : ""}
        ${showHrv ? metric("Avg HRV", `${avgHrv}ms`, "#34d399") : ""}
        ${showReadiness ? metric("Readiness", `${avgReadiness}`, "#60a5fa") : ""}
      </div>
    </div>` : ""}

    <!-- Activity -->
    ${showActivitySection ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">Activity</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${metric("Total Steps", totalSteps != null ? totalSteps.toLocaleString() : "—", "#fbbf24")}
        ${avgSteps != null ? metric("Daily Avg", avgSteps.toLocaleString(), "#fb923c") : ""}
      </div>
    </div>` : ""}

    <!-- Finances -->
    ${showSpending ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">Finances</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${metric("Total Spent", totalSpend!, "#f43f5e")}
      </div>
    </div>` : ""}

    <!-- Habits -->
    ${showHabits ? `
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
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
      const prefRows = await prisma.$queryRaw<{ value: string }[]>`
        SELECT "value" FROM "UserPreference" WHERE "userId" = ${user.id} AND "key" = 'digest_prefs' LIMIT 1
      `.catch(() => [] as { value: string }[])
      const savedPrefs = prefRows[0] ? JSON.parse(prefRows[0].value) : {}
      const prefs: DigestPrefs = {
        sections: { ...defaultPrefs.sections, ...(savedPrefs.sections ?? {}) },
        thresholds: { ...defaultPrefs.thresholds, ...(savedPrefs.thresholds ?? {}) },
      }
      const minDays = prefs.thresholds.minDays

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

      const sleepLogs = logs.filter(l => l.sleepDuration != null)
      const hrvLogs = logs.filter(l => l.hrv != null)
      const stepLogs = logs.filter(l => l.steps != null)

      const avgSleepMin = sleepLogs.length >= minDays ? avg(sleepLogs.map(l => l.sleepDuration)) : null
      const avgSleepH = avgSleepMin != null ? Math.round(avgSleepMin / 60 * 10) / 10 : null
      const avgHrv = hrvLogs.length >= minDays ? avg(hrvLogs.map(l => l.hrv)) : null
      const avgReadiness = avg(logs.map(l => l.readinessScore))
      const totalSteps = stepLogs.length >= minDays ? (logs.reduce((s, l) => s + (l.steps ?? 0), 0) || null) : null
      const avgSteps = totalSteps != null && logs.length ? Math.round(totalSteps / logs.length) : null

      const possibleCompletions = habits.length * 7
      const habitRate = possibleCompletions > 0
        ? Math.round((completions.length / possibleCompletions) * 100)
        : null

      const firstName = user.name?.split(" ")[0] ?? "there"
      const aiNarrative = await generateNarrative({
        name: firstName,
        avgSleepH: prefs.sections.sleep ? avgSleepH : null,
        avgHrv: prefs.sections.hrv ? avgHrv : null,
        avgReadiness,
        totalSteps: prefs.sections.steps ? totalSteps : null,
        habitRate: prefs.sections.habits ? habitRate : null,
      })

      const html = digestHtml({
        name: firstName,
        weekOf,
        aiNarrative,
        avgSleepH,
        avgHrv,
        avgReadiness,
        totalSteps,
        avgSteps,
        totalSpend,
        habitRate,
        prefs,
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
