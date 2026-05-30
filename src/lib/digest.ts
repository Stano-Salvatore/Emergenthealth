import { prisma } from "@/lib/prisma"
import { Resend } from "resend"

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

function buildHtml(params: {
  userName: string
  weekLabel: string
  avgSleepHrs: number | null
  avgSteps: number | null
  avgHrv: number | null
  avgReadiness: number | null
  totalWaterMl: number
  habitsCompleted: number
  bestDayLabel: string
  bestDayReadiness: number | null
}): string {
  const {
    userName, weekLabel, avgSleepHrs, avgSteps, avgHrv, avgReadiness,
    totalWaterMl, habitsCompleted, bestDayLabel, bestDayReadiness,
  } = params

  return `<!DOCTYPE html>
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
          <tr>
            <td style="padding-bottom:32px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;color:#888;letter-spacing:0.08em;text-transform:uppercase;">Weekly Health Digest</p>
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;">Hey ${userName} 👋</h1>
              <p style="margin:10px 0 0;font-size:14px;color:#666;">${weekLabel}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1a1a;border-radius:16px;padding:28px 32px;">
              <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#e0e0e0;">This week at a glance</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="font-size:20px;width:36px;">😴</td>
                    <td style="font-size:14px;color:#aaa;">Avg sleep</td>
                    <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmt(avgSleepHrs)} hrs</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="font-size:20px;width:36px;">🚶</td>
                    <td style="font-size:14px;color:#aaa;">Avg steps / day</td>
                    <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmtInt(avgSteps)}</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="font-size:20px;width:36px;">💜</td>
                    <td style="font-size:14px;color:#aaa;">Avg HRV</td>
                    <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmt(avgHrv, 0)} ms</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="font-size:20px;width:36px;">⚡</td>
                    <td style="font-size:14px;color:#aaa;">Avg readiness</td>
                    <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmt(avgReadiness, 0)} / 100</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="font-size:20px;width:36px;">💧</td>
                    <td style="font-size:14px;color:#aaa;">Total water intake</td>
                    <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${fmtInt(totalWaterMl > 0 ? totalWaterMl : null)} ml</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="font-size:20px;width:36px;">✅</td>
                    <td style="font-size:14px;color:#aaa;">Habits completed</td>
                    <td align="right" style="font-size:18px;font-weight:700;color:#ffffff;">${habitsCompleted}</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:12px 0;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="font-size:20px;width:36px;">🏆</td>
                    <td style="font-size:14px;color:#aaa;">Best day</td>
                    <td align="right" style="font-size:14px;font-weight:600;color:#a78bfa;">${bestDayLabel}${bestDayReadiness != null ? ` (${bestDayReadiness})` : ""}</td>
                  </tr></table>
                </td></tr>
              </table>
            </td>
          </tr>
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
}

export async function sendDigestForUser(userId: string, email: string): Promise<void> {
  const since = new Date()
  since.setDate(since.getDate() - 7)
  since.setHours(0, 0, 0, 0)

  const [healthLogs, intakeLogs, habitCompletions, user] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: "asc" },
      select: { date: true, sleepDuration: true, steps: true, hrv: true, readinessScore: true },
    }),
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: since }, type: "water" },
      select: { amountMl: true },
    }),
    prisma.habitCompletion.findMany({
      where: { userId, date: { gte: since } },
      select: { id: true },
    }).catch(() => [] as { id: string }[]),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ])

  const avgSleepHrs = avg(healthLogs.map(l => l.sleepDuration != null ? l.sleepDuration / 60 : null))
  const avgSteps = avg(healthLogs.map(l => l.steps))
  const avgHrv = avg(healthLogs.map(l => l.hrv))
  const avgReadiness = avg(healthLogs.map(l => l.readinessScore))
  const totalWaterMl = intakeLogs.reduce((s, l) => s + l.amountMl, 0)
  const habitsCompleted = habitCompletions.length

  const bestDay = healthLogs
    .filter(l => l.readinessScore != null)
    .sort((a, b) => b.readinessScore! - a.readinessScore!)[0] ?? null

  const bestDayLabel = bestDay
    ? new Date(bestDay.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    : "—"

  const userName = user?.name?.split(" ")[0] ?? "there"
  const end = new Date()
  const weekLabel = `${since.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`

  const html = buildHtml({
    userName,
    weekLabel,
    avgSleepHrs,
    avgSteps,
    avgHrv,
    avgReadiness,
    totalWaterMl,
    habitsCompleted,
    bestDayLabel,
    bestDayReadiness: bestDay?.readinessScore ?? null,
  })

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: "Emergenthealth <onboarding@resend.dev>",
    to: email,
    subject: "Your weekly health digest 📊",
    html,
  })

  if (error) throw new Error(error.message ?? "Failed to send email")
}
