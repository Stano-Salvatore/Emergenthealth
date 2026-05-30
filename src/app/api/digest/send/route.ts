import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { Resend } from "resend"
import Anthropic from "@anthropic-ai/sdk"

function avg(arr: (number | null | undefined)[]): number | null {
  const vals = arr.filter((x): x is number => x != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function fmt(n: number | null, decimals = 1): string {
  return n != null ? n.toFixed(decimals) : "—"
}

function fmtInt(n: number | null): string {
  return n != null ? Math.round(n).toLocaleString() : "—"
}

function delta(cur: number | null, prev: number | null): { pct: number; up: boolean } | null {
  if (cur == null || prev == null || prev === 0) return null
  const pct = ((cur - prev) / prev) * 100
  return { pct: Math.abs(pct), up: pct >= 0 }
}

function deltaHtml(d: { pct: number; up: boolean } | null, higherIsBetter = true): string {
  if (!d || d.pct < 1) return ""
  const good = d.up === higherIsBetter
  const color = good ? "#4ade80" : "#f87171"
  const arrow = d.up ? "↑" : "↓"
  return `<span style="color:${color};font-size:11px;margin-left:6px;">${arrow}${d.pct.toFixed(0)}%</span>`
}

async function generateNarrative(summary: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `You are a personal health coach writing a weekly email. Given this week's data, write 2-3 short plain-text sentences (no bullet points, no markdown) highlighting the most notable pattern or achievement and one actionable suggestion. Be specific and human — mention actual numbers. Under 60 words total.\n\n${summary}`,
      }],
    })
    const text = res.content.find(b => b.type === "text")
    return text?.type === "text" ? (text as { type: "text"; text: string }).text.trim() : null
  } catch {
    return null
  }
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const email = session.user.email
  if (!email) {
    return NextResponse.json({ error: "No email on account" }, { status: 400 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email service not configured" }, { status: 503 })
  }

  const since = new Date()
  since.setDate(since.getDate() - 7)
  since.setHours(0, 0, 0, 0)

  const prevSince = new Date(since)
  prevSince.setDate(prevSince.getDate() - 7)

  try {
    const [healthLogs, prevHealthLogs, intakeLogs, habitCompletions, transactions] = await Promise.all([
      prisma.healthLog.findMany({
        where: { userId, date: { gte: since } },
        orderBy: { date: "asc" },
        select: { date: true, sleepDuration: true, steps: true, hrv: true, readinessScore: true },
      }).catch(() => [] as { date: Date; sleepDuration: number | null; steps: number | null; hrv: number | null; readinessScore: number | null }[]),
      prisma.healthLog.findMany({
        where: { userId, date: { gte: prevSince, lt: since } },
        select: { sleepDuration: true, steps: true, hrv: true, readinessScore: true },
      }).catch(() => [] as { sleepDuration: number | null; steps: number | null; hrv: number | null; readinessScore: number | null }[]),
      prisma.intakeLog.findMany({
        where: { userId, loggedAt: { gte: since }, type: "water" },
        select: { amountMl: true },
      }).catch(() => [] as { amountMl: number }[]),
      prisma.habitCompletion.findMany({
        where: { userId, date: { gte: since } },
        select: { id: true },
      }).catch(() => [] as { id: string }[]),
      prisma.transaction.findMany({
        where: { userId, date: { gte: since }, isTransfer: false, amount: { lt: 0 } },
        select: { amount: true, category: true },
      }).catch(() => [] as { amount: number; category: string | null }[]),
    ])

    // Current week aggregates
    const avgSleepHrs = avg(healthLogs.map(l => l.sleepDuration != null ? l.sleepDuration / 60 : null))
    const avgSteps = avg(healthLogs.map(l => l.steps))
    const avgHrv = avg(healthLogs.map(l => l.hrv))
    const avgReadiness = avg(healthLogs.map(l => l.readinessScore))

    // Previous week aggregates
    const prevAvgSleepHrs = avg(prevHealthLogs.map(l => l.sleepDuration != null ? l.sleepDuration / 60 : null))
    const prevAvgSteps = avg(prevHealthLogs.map(l => l.steps))
    const prevAvgHrv = avg(prevHealthLogs.map(l => l.hrv))
    const prevAvgReadiness = avg(prevHealthLogs.map(l => l.readinessScore))

    const totalWaterMl = intakeLogs.reduce((s, l) => s + l.amountMl, 0)
    const habitsCompleted = habitCompletions.length

    // Spending by category
    const spendByCategory: Record<string, number> = {}
    let totalSpend = 0
    for (const t of transactions) {
      const cat = t.category ?? "Other"
      const amount = Math.abs(t.amount) / 100
      spendByCategory[cat] = (spendByCategory[cat] ?? 0) + amount
      totalSpend += amount
    }
    const topCategories = Object.entries(spendByCategory)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)

    // Best / worst day by readiness
    const bestDay = healthLogs
      .filter(l => l.readinessScore != null)
      .sort((a, b) => b.readinessScore! - a.readinessScore!)[0] ?? null
    const worstDay = healthLogs
      .filter(l => l.readinessScore != null)
      .sort((a, b) => a.readinessScore! - b.readinessScore!)[0] ?? null

    const bestDayLabel = bestDay
      ? new Date(bestDay.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
      : "—"

    const userName = session.user.name?.split(" ")[0] ?? "there"
    const weekLabel = (() => {
      const end = new Date()
      const start = new Date(since)
      return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    })()

    // Week-over-week deltas
    const dSleep = delta(avgSleepHrs, prevAvgSleepHrs)
    const dSteps = delta(avgSteps, prevAvgSteps)
    const dHrv = delta(avgHrv, prevAvgHrv)
    const dReadiness = delta(avgReadiness, prevAvgReadiness)

    // Build AI narrative context
    const summaryLines = [
      `Week of ${weekLabel}`,
      avgSleepHrs != null ? `Sleep avg: ${avgSleepHrs.toFixed(1)} hrs (prev week: ${prevAvgSleepHrs?.toFixed(1) ?? "—"})` : null,
      avgSteps != null ? `Steps avg: ${Math.round(avgSteps).toLocaleString()}/day (prev: ${prevAvgSteps != null ? Math.round(prevAvgSteps).toLocaleString() : "—"})` : null,
      avgHrv != null ? `HRV avg: ${Math.round(avgHrv)} ms` : null,
      avgReadiness != null ? `Readiness avg: ${Math.round(avgReadiness)}/100` : null,
      habitsCompleted > 0 ? `Habits completed: ${habitsCompleted}` : null,
      totalWaterMl > 0 ? `Water: ${(totalWaterMl / 1000).toFixed(1)}L` : null,
      totalSpend > 0 ? `Spent: €${totalSpend.toFixed(0)} (top: ${topCategories[0]?.[0] ?? "—"})` : null,
      bestDay ? `Best day: ${bestDayLabel} (readiness ${bestDay.readinessScore})` : null,
    ].filter(Boolean).join("\n")

    const narrative = await generateNarrative(summaryLines)

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Weekly Health Digest</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f0f0f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:24px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;color:#888;letter-spacing:0.08em;text-transform:uppercase;">Weekly Health Digest</p>
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;">Hey ${userName} 👋</h1>
              <p style="margin:10px 0 0;font-size:14px;color:#666;">${weekLabel}</p>
            </td>
          </tr>

          ${narrative ? `
          <!-- AI narrative -->
          <tr>
            <td style="background:#1a1a2e;border-radius:12px;padding:20px 24px;border:1px solid rgba(167,139,250,0.2);">
              <p style="margin:0 0 8px;font-size:11px;color:#a78bfa;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;">Your week</p>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#e0e0e0;">${narrative}</p>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
          ` : ""}

          <!-- Stats card -->
          <tr>
            <td style="background:#1a1a1a;border-radius:16px;padding:28px 32px;">
              <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#e0e0e0;">Numbers</p>
              <table width="100%" cellpadding="0" cellspacing="0">

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="font-size:20px;width:36px;">😴</td>
                      <td style="font-size:14px;color:#aaa;">Avg sleep</td>
                      <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmt(avgSleepHrs)} hrs${deltaHtml(dSleep)}</td>
                    </tr></table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="font-size:20px;width:36px;">🚶</td>
                      <td style="font-size:14px;color:#aaa;">Avg steps / day</td>
                      <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmtInt(avgSteps)}${deltaHtml(dSteps)}</td>
                    </tr></table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="font-size:20px;width:36px;">💜</td>
                      <td style="font-size:14px;color:#aaa;">Avg HRV</td>
                      <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmt(avgHrv, 0)} ms${deltaHtml(dHrv)}</td>
                    </tr></table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="font-size:20px;width:36px;">⚡</td>
                      <td style="font-size:14px;color:#aaa;">Avg readiness</td>
                      <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmt(avgReadiness, 0)} / 100${deltaHtml(dReadiness)}</td>
                    </tr></table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="font-size:20px;width:36px;">💧</td>
                      <td style="font-size:14px;color:#aaa;">Total water</td>
                      <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmtInt(totalWaterMl > 0 ? totalWaterMl : null)} ml</td>
                    </tr></table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="font-size:20px;width:36px;">✅</td>
                      <td style="font-size:14px;color:#aaa;">Habits completed</td>
                      <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${habitsCompleted}</td>
                    </tr></table>
                  </td>
                </tr>

                ${totalSpend > 0 ? `
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="font-size:20px;width:36px;">💸</td>
                      <td style="font-size:14px;color:#aaa;">Total spent</td>
                      <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">€${totalSpend.toFixed(0)}</td>
                    </tr></table>
                    ${topCategories.length > 0 ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">
                      ${topCategories.map(([cat, amt]) => `<tr>
                        <td style="font-size:12px;color:#555;padding-left:36px;">${cat}</td>
                        <td align="right" style="font-size:12px;color:#555;">€${amt.toFixed(0)}</td>
                      </tr>`).join("")}
                    </table>` : ""}
                  </td>
                </tr>
                ` : ""}

                <tr>
                  <td style="padding:12px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="font-size:20px;width:36px;">🏆</td>
                      <td style="font-size:14px;color:#aaa;">Best day</td>
                      <td align="right" style="font-size:14px;font-weight:600;color:#a78bfa;">${bestDayLabel}${bestDay?.readinessScore != null ? ` (${bestDay.readinessScore})` : ""}</td>
                    </tr></table>
                    ${worstDay && worstDay.date !== bestDay?.date ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;"><tr>
                      <td style="font-size:20px;width:36px;">📉</td>
                      <td style="font-size:12px;color:#555;">Hardest day</td>
                      <td align="right" style="font-size:12px;color:#555;">${new Date(worstDay.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${worstDay.readinessScore != null ? ` (${worstDay.readinessScore})` : ""}</td>
                    </tr></table>` : ""}
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:28px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#555;">Sent by Emergenthealth · You requested this digest from Settings</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "Email not configured — add RESEND_API_KEY to environment variables." }, { status: 503 })
    }

    const resend = new Resend(process.env.RESEND_API_KEY)

    const { error } = await resend.emails.send({
      from: "Emergenthealth <onboarding@resend.dev>",
      to: email,
      subject: "Your weekly health digest 📊",
      html,
    })

    if (error) {
      console.error("[digest] Resend error:", error)
      return NextResponse.json({ error: error.message ?? "Failed to send email" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[digest] Unexpected error:", err)
    return NextResponse.json({ error: err?.message ?? "Unexpected error sending digest" }, { status: 500 })
  }
}
