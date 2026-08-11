import type { Metadata } from "next"
export const metadata: Metadata = { title: "Health" }

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { HealthEntryForm } from "@/components/health/HealthEntryForm"
import { OuraSyncButton } from "@/components/health/OuraSyncButton"
import { HealthTabBar } from "@/components/health/HealthTabBar"
import {
  SleepChart, StepsChart, HRChart, WeightChart, ActivityChart,
  ReadinessChart, HRVChart, SpO2Chart, ActivityScoreChart,
  StressRecoveryChart, BreathingRateChart, MoodChart,
  type ChartDay,
} from "@/components/health/HealthCharts"
import { Moon, Footprints, Heart, Scale, Zap, Activity, Thermometer, Wind, Shield, TrendingDown, TrendingUp, Minus } from "lucide-react"
import { format, subDays } from "date-fns"
import WeightPage from "@/app/dashboard/weight/page"
import InsightsPage from "@/app/dashboard/insights/page"
import LabsPage from "@/app/dashboard/labs/page"
import BodyPage from "@/app/dashboard/body/page"
import { isFeatureEnabled } from "@/lib/features"
import { getUserTimezone, localDateStr, addDaysISO } from "@/lib/local-date"

interface StravaActivityRow {
  id: string
  type: string
  name: string | null
  distanceM: number | null
  movingTimeSec: number
  startDate: Date
  day: string
}

const DEFAULT_STEP_GOAL = 8_000
const DEFAULT_SLEEP_GOAL_H = 7.5

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const activeTab = tab ?? "metrics"

  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id

  const goalsRow = await prisma.dailyNote.findUnique({
    where: { userId_date: { userId, date: new Date("0001-01-01") } },
  }).catch(() => null)
  const userGoals = goalsRow ? JSON.parse(goalsRow.content) as { sleepH?: number; steps?: number } : {}
  const STEP_GOAL = userGoals.steps ?? DEFAULT_STEP_GOAL
  const SLEEP_GOAL_H = userGoals.sleepH ?? DEFAULT_SLEEP_GOAL_H

  if (activeTab === "weight") {
    return (
      <div className="space-y-6">
        <HealthTabBar activeTab={activeTab} />
        <WeightPage />
      </div>
    )
  }
  if (activeTab === "body") {
    return (
      <div className="space-y-6">
        <HealthTabBar activeTab={activeTab} />
        <BodyPage />
      </div>
    )
  }
  if (activeTab === "correlations") {
    return (
      <div className="space-y-6">
        <HealthTabBar activeTab={activeTab} />
        <InsightsPage />
      </div>
    )
  }
  if (activeTab === "labs" && isFeatureEnabled("labs")) {
    return (
      <div className="space-y-6">
        <HealthTabBar activeTab={activeTab} />
        <LabsPage />
      </div>
    )
  }

  const ouraToken = await prisma.ouraToken.findUnique({ where: { userId }, select: { id: true } })
  const isOuraConnected = !!ouraToken

  // 14 days back from the user's today, not the server's — on UTC the window
  // slipped a day for anyone east of Greenwich late in the evening.
  const timezone = await getUserTimezone(userId)
  const since14str = addDaysISO(localDateStr(timezone), -14)
  const stravaActivities = await prisma.stravaActivity.findMany({
    where: { userId, day: { gte: since14str } },
    orderBy: { startDate: "desc" },
    take: 30,
    select: { id: true, type: true, name: true, distanceM: true, movingTimeSec: true, startDate: true, day: true },
  }).catch(() => [] as StravaActivityRow[])

  const since30 = new Date()
  since30.setDate(since30.getDate() - 29)

  const [moodLogs, logs] = await Promise.all([
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since30 } },
      orderBy: { date: "desc" },
      take: 30,
    }),
    prisma.healthLog.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 30,
    select: {
      id: true,
      date: true,
      sleepDuration: true,
      deepSleep: true,
      remSleep: true,
      lightSleep: true,
      steps: true,
      restingHR: true,
      weight: true,
      activeMinutes: true,
      caloriesBurned: true,
      readinessScore: true,
      hrv: true,
      spo2: true,
      skinTemp: true,
      sleepEfficiency: true,
      sleepLatency: true,
      stressHigh: true,
      totalCalories: true,
      distanceKm: true,
      breathingRate: true,
      awakeTime: true,
      timeInBed: true,
      restlessPeriods: true,
      activityScore: true,
      recoveryHigh: true,
      sedentaryTime: true,
      breathingDisturbance: true,
      sleepStart: true,
      sleepEnd: true,
      sleepScore: true,
    },
  }),
  ])

  const moodByDate = Object.fromEntries(
    moodLogs.map(m => [m.date.toISOString().split("T")[0], m.mood])
  )

  const recent7 = logs.slice(0, 7)
  const prior7  = logs.slice(7, 14)
  function avg(arr: (number | null)[]) {
    const vals = arr.filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }

  const avgSleepMin     = avg(recent7.map(l => l.sleepDuration))
  const avgSteps        = avg(recent7.map(l => l.steps))
  const avgHR           = avg(recent7.map(l => l.restingHR))
  const avgWeight       = avg(recent7.map(l => l.weight))
  const avgActiveMins   = avg(recent7.map(l => l.activeMinutes))
  const avgReadiness    = avg(recent7.map(l => l.readinessScore))
  const avgHRV          = avg(recent7.map(l => l.hrv))
  const avgSpo2         = avg(recent7.map(l => l.spo2))
  const avgActivityScore = avg(recent7.map(l => l.activityScore))
  const avgSleepScore   = avg(recent7.map(l => l.sleepScore))

  // Week-over-week trend: "+0.4h", "-312", … next to each 7-day average.
  // lowerIsBetter flips the good/bad coloring (resting HR, sedentary time).
  function trend(cur: number | null, prev: number | null, opts: {
    digits?: number; suffix?: string; lowerIsBetter?: boolean; minDelta?: number
  } = {}): { text: string; good: boolean } | null {
    if (cur == null || prev == null) return null
    const d = cur - prev
    if (Math.abs(d) < (opts.minDelta ?? 0)) return null
    const num = (opts.digits ?? 0) > 0 ? Math.abs(d).toFixed(opts.digits) : Math.round(Math.abs(d)).toLocaleString()
    return {
      text: `${d >= 0 ? "▲" : "▼"} ${num}${opts.suffix ?? ""}`,
      good: opts.lowerIsBetter ? d < 0 : d > 0,
    }
  }

  const tSleepScore = trend(avgSleepScore, avg(prior7.map(l => l.sleepScore)), { minDelta: 1 })
  const tSleep      = trend(
    avgSleepMin != null ? avgSleepMin / 60 : null,
    (() => { const p = avg(prior7.map(l => l.sleepDuration)); return p != null ? p / 60 : null })(),
    { digits: 1, suffix: "h", minDelta: 0.1 })
  const tSteps      = trend(avgSteps, avg(prior7.map(l => l.steps)), { minDelta: 100 })
  const tHR         = trend(avgHR, avg(prior7.map(l => l.restingHR)), { lowerIsBetter: true, minDelta: 1 })
  const tActive     = trend(avgActiveMins, avg(prior7.map(l => l.activeMinutes)), { suffix: "m", minDelta: 3 })
  const tReadiness  = trend(avgReadiness, avg(prior7.map(l => l.readinessScore)), { minDelta: 1 })
  const tHRV        = trend(avgHRV, avg(prior7.map(l => l.hrv)), { suffix: "ms", minDelta: 1 })
  const tActivityScore = trend(avgActivityScore, avg(prior7.map(l => l.activityScore)), { minDelta: 1 })
  const tWeight     = (() => {
    const t = trend(avgWeight, avg(prior7.map(l => l.weight)), { digits: 1, suffix: "kg", minDelta: 0.1 })
    return t ? { text: t.text, good: null } : null   // weight direction isn't inherently good or bad
  })()

  // Sleep debt (7-day window)
  const sleepDebtDays = recent7.filter(l => l.sleepDuration != null)
  const debtGoalMin   = sleepDebtDays.length * SLEEP_GOAL_H * 60
  const debtActualMin = sleepDebtDays.reduce((s, l) => s + (l.sleepDuration ?? 0), 0)
  const debtMin       = debtGoalMin - debtActualMin  // positive = in debt

  const chartData: ChartDay[] = logs.map(l => ({
    date: format(l.date, "MMM d"),
    sleepH:        l.sleepDuration != null ? Math.round((l.sleepDuration / 60) * 10) / 10 : null,
    deepMin:       l.deepSleep ?? null,
    remMin:        l.remSleep ?? null,
    lightMin:      l.lightSleep ?? null,
    awakeMin:      l.awakeTime ?? null,
    steps:         l.steps ?? null,
    restingHR:     l.restingHR ?? null,
    weight:        l.weight ?? null,
    activeMin:     l.activeMinutes ?? null,
    calories:      l.caloriesBurned ?? null,
    readiness:     l.readinessScore ?? null,
    hrv:           l.hrv ?? null,
    spo2:          l.spo2 ?? null,
    distanceKm:    l.distanceKm ?? null,
    breathingRate: l.breathingRate ?? null,
    activityScore: l.activityScore ?? null,
    stressHigh:    l.stressHigh ?? null,
    recoveryHigh:  l.recoveryHigh ?? null,
    sedentaryMin:  l.sedentaryTime ?? null,
    mood:          moodByDate[l.date.toISOString().split("T")[0]] ?? null,
  }))

  const latestLog = logs[0] ?? null

  function readinessColor(score: number) {
    if (score >= 85) return "text-green-400"
    if (score >= 70) return "text-amber-400"
    return "text-red-400"
  }

  function scoreColor(score: number) {
    if (score >= 85) return "text-green-400"
    if (score >= 70) return "text-amber-400"
    return "text-red-400"
  }

  return (
    <div className="space-y-6">
      {/* ── header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Health</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {logs.length} days of data · synced from Oura Ring
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isOuraConnected && <OuraSyncButton />}
          <HealthEntryForm />
        </div>
      </div>

      <HealthTabBar activeTab="metrics" />

      {logs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 text-5xl leading-none select-none">🌙</div>
            <h3 className="text-base font-semibold text-foreground">No health data yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">Get started with one of these options:</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground text-left">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5 shrink-0">•</span>
                <span>
                  Connect Oura Ring in{" "}
                  <a href="/dashboard/settings" className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">
                    Settings → Integrations
                  </a>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5 shrink-0">•</span>
                <span>Or click <span className="font-medium text-foreground">&quot;Log Day&quot;</span> to add data manually</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── today's scores hero ── */}
          {latestLog && (latestLog.sleepScore != null || latestLog.readinessScore != null || latestLog.activityScore != null) && (
            <Card>
              <CardContent className="py-5">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <p className="text-sm font-medium">{format(latestLog.date, "EEEE, MMM d")}</p>
                  <p className="text-xs text-muted-foreground">latest synced day</p>
                </div>
                <div className="flex items-center justify-around flex-wrap gap-4">
                  <ScoreRing label="Sleep" score={latestLog.sleepScore}
                    sub={latestLog.sleepDuration != null ? `${(latestLog.sleepDuration / 60).toFixed(1)}h` : undefined} />
                  <ScoreRing label="Readiness" score={latestLog.readinessScore}
                    sub={latestLog.hrv != null ? `${Math.round(latestLog.hrv)}ms HRV` : undefined} />
                  <ScoreRing label="Activity" score={latestLog.activityScore}
                    sub={latestLog.steps != null ? `${latestLog.steps.toLocaleString()} steps` : undefined} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── 7-day summary (▲▼ vs the week before) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-10 gap-3">
            <SummaryCard icon={<Moon className="h-4 w-4 text-primary" />} label="Sleep score"
              value={avgSleepScore != null ? `${Math.round(avgSleepScore)}` : "—"}
              good={avgSleepScore != null && avgSleepScore >= 85} target="goal 85+" delta={tSleepScore} />
            <SummaryCard icon={<Moon className="h-4 w-4 text-primary" />} label="Avg sleep"
              value={avgSleepMin != null ? `${(avgSleepMin / 60).toFixed(1)}h` : "—"}
              good={avgSleepMin != null && avgSleepMin / 60 >= SLEEP_GOAL_H} target={`goal ${SLEEP_GOAL_H}h`} delta={tSleep} />
            <SummaryCard icon={<Footprints className="h-4 w-4 text-green-400" />} label="Avg steps"
              value={avgSteps != null ? Math.round(avgSteps).toLocaleString() : "—"}
              good={avgSteps != null && avgSteps >= STEP_GOAL} target={`goal ${STEP_GOAL.toLocaleString()}`} delta={tSteps} />
            <SummaryCard icon={<Heart className="h-4 w-4 text-red-400" />} label="Avg resting HR"
              value={avgHR != null ? `${Math.round(avgHR)} bpm` : "—"} delta={tHR} />
            <SummaryCard icon={<Scale className="h-4 w-4 text-blue-400" />} label="Latest weight"
              value={avgWeight != null ? `${avgWeight.toFixed(1)} kg` : "—"} delta={tWeight} />
            <SummaryCard icon={<Zap className="h-4 w-4 text-amber-400" />} label="Avg active"
              value={avgActiveMins != null ? `${Math.round(avgActiveMins)} min` : "—"} delta={tActive} />
            <SummaryCard icon={<Shield className="h-4 w-4 text-emerald-400" />} label="Avg readiness"
              value={avgReadiness != null ? `${Math.round(avgReadiness)}` : "—"}
              good={avgReadiness != null && avgReadiness >= 70} target="goal 70+" delta={tReadiness} />
            <SummaryCard icon={<Activity className="h-4 w-4 text-primary" />} label="Avg HRV"
              value={avgHRV != null ? `${Math.round(avgHRV)} ms` : "—"} delta={tHRV} />
            <SummaryCard icon={<Wind className="h-4 w-4 text-cyan-400" />} label="Avg SpO₂"
              value={avgSpo2 != null ? `${avgSpo2.toFixed(1)}%` : "—"}
              good={avgSpo2 != null && avgSpo2 >= 95} />
            <SummaryCard icon={<Zap className="h-4 w-4 text-amber-300" />} label="Avg activity"
              value={avgActivityScore != null ? `${Math.round(avgActivityScore)}` : "—"}
              good={avgActivityScore != null && avgActivityScore >= 70} target="goal 70+" delta={tActivityScore} />
          </div>

          {/* ── sleep debt ── */}
          {sleepDebtDays.length >= 2 && (
            <Card className={debtMin > 120 ? "border-red-500/30" : debtMin > 0 ? "border-amber-500/30" : "border-green-500/30"}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Moon className="h-4 w-4 text-primary" />
                    Sleep Debt — last {sleepDebtDays.length} nights
                  </CardTitle>
                  <Badge variant="secondary" className={`text-xs font-semibold flex items-center gap-1 ${debtMin > 120 ? "text-red-400" : debtMin > 0 ? "text-amber-400" : "text-green-400"}`}>
                    {debtMin > 120 ? <TrendingDown className="h-3 w-3" /> : debtMin > 0 ? <Minus className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                    {debtMin > 0 ? `${(debtMin / 60).toFixed(1)}h in debt` : `${(Math.abs(debtMin) / 60).toFixed(1)}h surplus`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Goal progress */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Actual sleep</span>
                    <span>{(debtActualMin / 60).toFixed(1)}h of {(debtGoalMin / 60).toFixed(0)}h goal</span>
                  </div>
                  <Progress value={Math.min((debtActualMin / debtGoalMin) * 100, 100)}
                    className={`h-2 ${debtMin > 120 ? "[&>div]:bg-red-500" : debtMin > 0 ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500"}`} />
                </div>

                {/* Per-night bars */}
                <div className="flex items-end gap-1.5" style={{ height: 56 }}>
                  {recent7.map((log, i) => {
                    const h = log.sleepDuration != null ? log.sleepDuration / 60 : 0
                    const pct = Math.min((h / (SLEEP_GOAL_H + 2)) * 100, 100)
                    const goalPct = (SLEEP_GOAL_H / (SLEEP_GOAL_H + 2)) * 100
                    const color = h === 0 ? "bg-secondary" : h >= SLEEP_GOAL_H ? "bg-green-500" : h >= 6 ? "bg-amber-500" : "bg-red-500"
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1 relative" style={{ height: 56 }}>
                        {/* Goal line */}
                        <div className="absolute w-full border-t border-dashed border-muted-foreground/30"
                          style={{ bottom: `${goalPct}%` }} />
                        {/* Bar */}
                        <div className="absolute bottom-5 w-full flex items-end" style={{ height: "80%" }}>
                          <div className={`w-full rounded-sm transition-all ${color}`}
                            style={{ height: `${pct}%`, minHeight: h > 0 ? 3 : 0 }} />
                        </div>
                        {/* Day label */}
                        <span className="absolute bottom-0 text-[9px] text-muted-foreground">
                          {format(log.date, "EEE")}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Tip */}
                {debtMin > 120 && (
                  <p className="text-xs text-muted-foreground bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2">
                    💡 You&apos;re {(debtMin / 60).toFixed(1)}h short this week. Try adding 30–45 min earlier each night — large sleep debts can&apos;t be fully repaid in one go.
                  </p>
                )}
                {debtMin <= 0 && (
                  <p className="text-xs text-muted-foreground bg-green-500/5 border border-green-500/15 rounded-lg px-3 py-2">
                    🌟 You&apos;re on track — {(Math.abs(debtMin) / 60).toFixed(1)}h ahead of your sleep goal this week. Keep it up!
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── latest day detail ── */}
          {latestLog && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base font-medium min-w-0">
                    {format(latestLog.date, "EEEE, MMM d")} — latest
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {latestLog.sleepScore != null && (
                      <Badge variant="secondary" className={`text-xs ${scoreColor(latestLog.sleepScore)}`}>
                        Sleep {latestLog.sleepScore}
                      </Badge>
                    )}
                    {latestLog.readinessScore != null && (
                      <Badge variant="secondary" className={`text-xs ${readinessColor(latestLog.readinessScore)}`}>
                        Readiness {latestLog.readinessScore}
                      </Badge>
                    )}
                    {latestLog.activityScore != null && (
                      <Badge variant="secondary" className={`text-xs ${scoreColor(latestLog.activityScore)}`}>
                        Activity {latestLog.activityScore}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Sleep section */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Sleep</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatBox icon={<Moon className="h-4 w-4 text-primary" />} label="Sleep"
                      value={latestLog.sleepDuration != null ? `${(latestLog.sleepDuration / 60).toFixed(1)}h` : "—"} />
                    <StatBox icon={<span className="text-sm">💤</span>} label="Deep / REM"
                      value={latestLog.deepSleep != null || latestLog.remSleep != null
                        ? `${latestLog.deepSleep ?? "?"}m / ${latestLog.remSleep ?? "?"}m` : "—"} />
                    {latestLog.awakeTime != null && (
                      <StatBox icon={<span className="text-sm">👁️</span>} label="Awake"
                        value={`${latestLog.awakeTime} min`} />
                    )}
                    {latestLog.timeInBed != null && (
                      <StatBox icon={<span className="text-sm">🛏️</span>} label="Time in bed"
                        value={`${(latestLog.timeInBed / 60).toFixed(1)}h`} />
                    )}
                    {latestLog.sleepEfficiency != null && (
                      <StatBox icon={<span className="text-sm">⚡</span>} label="Efficiency"
                        value={`${latestLog.sleepEfficiency}%`} />
                    )}
                    {latestLog.sleepLatency != null && (
                      <StatBox icon={<span className="text-sm">🕐</span>} label="Latency"
                        value={`${latestLog.sleepLatency} min`} />
                    )}
                    {latestLog.restlessPeriods != null && (
                      <StatBox icon={<span className="text-sm">🔄</span>} label="Restless"
                        value={`${latestLog.restlessPeriods}×`} />
                    )}
                    {latestLog.breathingRate != null && (
                      <StatBox icon={<Wind className="h-4 w-4 text-teal-400" />} label="Breathing rate"
                        value={`${latestLog.breathingRate.toFixed(1)} /min`} />
                    )}
                    {latestLog.sleepStart != null && latestLog.sleepEnd != null && (
                      <StatBox icon={<span className="text-sm">🌙</span>} label="Bedtime"
                        value={`${format(latestLog.sleepStart, "HH:mm")}–${format(latestLog.sleepEnd, "HH:mm")}`} />
                    )}
                  </div>
                </div>

                {/* Activity section */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Activity</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatBox icon={<Footprints className="h-4 w-4 text-green-400" />} label="Steps"
                      value={latestLog.steps != null ? latestLog.steps.toLocaleString() : "—"} />
                    {latestLog.distanceKm != null && (
                      <StatBox icon={<span className="text-sm">🏃</span>} label="Distance"
                        value={`${latestLog.distanceKm.toFixed(2)} km`} />
                    )}
                    {latestLog.activeMinutes != null && (
                      <StatBox icon={<Zap className="h-4 w-4 text-amber-400" />} label="Active min"
                        value={`${latestLog.activeMinutes} min`} />
                    )}
                    {latestLog.sedentaryTime != null && (
                      <StatBox icon={<span className="text-sm">🪑</span>} label="Sedentary"
                        value={`${Math.round(latestLog.sedentaryTime / 60)}h`} />
                    )}
                    {latestLog.caloriesBurned != null && (
                      <StatBox icon={<span className="text-sm">🔥</span>} label="Active cal"
                        value={`${latestLog.caloriesBurned} kcal`} />
                    )}
                    {latestLog.totalCalories != null && (
                      <StatBox icon={<span className="text-sm">🍽️</span>} label="Total cal"
                        value={`${latestLog.totalCalories} kcal`} />
                    )}
                  </div>
                </div>

                {/* Body & recovery section */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Body & Recovery</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatBox icon={<Heart className="h-4 w-4 text-red-400" />} label="Resting HR"
                      value={latestLog.restingHR != null ? `${latestLog.restingHR} bpm` : "—"} />
                    {latestLog.hrv != null && (
                      <StatBox icon={<Activity className="h-4 w-4 text-primary" />} label="HRV"
                        value={`${Math.round(latestLog.hrv)} ms`} />
                    )}
                    {latestLog.spo2 != null && (
                      <StatBox icon={<Wind className="h-4 w-4 text-cyan-400" />} label="SpO₂"
                        value={`${(latestLog.spo2 as number).toFixed(1)}%`} />
                    )}
                    {latestLog.breathingDisturbance != null && (
                      <StatBox icon={<span className="text-sm">🌬️</span>} label="Breath disturb."
                        value={`${(latestLog.breathingDisturbance as number).toFixed(1)}`} />
                    )}
                    {latestLog.skinTemp != null && (
                      <StatBox icon={<Thermometer className="h-4 w-4 text-orange-400" />} label="Skin temp Δ"
                        value={`${latestLog.skinTemp > 0 ? "+" : ""}${(latestLog.skinTemp as number).toFixed(2)}°C`} />
                    )}
                    {latestLog.stressHigh != null && (
                      <StatBox icon={<span className="text-sm">😤</span>} label="High stress"
                        value={`${latestLog.stressHigh} min`} />
                    )}
                    {latestLog.recoveryHigh != null && (
                      <StatBox icon={<span className="text-sm">🌿</span>} label="Recovery"
                        value={`${latestLog.recoveryHigh} min`} />
                    )}
                    {latestLog.weight != null && (
                      <StatBox icon={<Scale className="h-4 w-4 text-blue-400" />} label="Weight"
                        value={`${latestLog.weight} kg`} />
                    )}
                  </div>
                </div>

                {/* Progress bars */}
                <div className="space-y-2">
                  {latestLog.steps != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Steps to goal</span>
                        <span>{latestLog.steps.toLocaleString()} / {STEP_GOAL.toLocaleString()}</span>
                      </div>
                      <Progress value={Math.min((latestLog.steps / STEP_GOAL) * 100, 100)} className="h-1.5" />
                    </div>
                  )}
                  {latestLog.sleepDuration != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Sleep to goal</span>
                        <span>{(latestLog.sleepDuration / 60).toFixed(1)}h / {SLEEP_GOAL_H}h</span>
                      </div>
                      <Progress value={Math.min((latestLog.sleepDuration / (SLEEP_GOAL_H * 60)) * 100, 100)} className="h-1.5" />
                    </div>
                  )}
                  {latestLog.readinessScore != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Readiness</span>
                        <span>{latestLog.readinessScore} / 100</span>
                      </div>
                      <Progress value={latestLog.readinessScore} className="h-1.5" />
                    </div>
                  )}
                  {latestLog.activityScore != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Activity score</span>
                        <span>{latestLog.activityScore} / 100</span>
                      </div>
                      <Progress value={latestLog.activityScore} className="h-1.5" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── charts ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">

            {chartData.some(d => d.sleepH != null) && (
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Moon className="h-4 w-4 text-primary" /> Sleep — last {Math.min(logs.length, 30)} days
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 overflow-x-auto"><SleepChart data={chartData} goal={SLEEP_GOAL_H} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.readiness != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Shield className="h-4 w-4 text-emerald-400" /> Readiness Score
                  </CardTitle>
                </CardHeader>
                <CardContent><ReadinessChart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.activityScore != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-400" /> Activity Score
                  </CardTitle>
                </CardHeader>
                <CardContent><ActivityScoreChart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.steps != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Footprints className="h-4 w-4 text-green-400" /> Steps
                  </CardTitle>
                </CardHeader>
                <CardContent><StepsChart data={chartData} goal={STEP_GOAL} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.activeMin != null || d.calories != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-400" /> Activity
                  </CardTitle>
                </CardHeader>
                <CardContent><ActivityChart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.stressHigh != null || d.recoveryHigh != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <span className="text-sm">😤</span> Stress & Recovery
                  </CardTitle>
                </CardHeader>
                <CardContent><StressRecoveryChart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.hrv != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-primary" /> HRV
                  </CardTitle>
                </CardHeader>
                <CardContent><HRVChart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.restingHR != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Heart className="h-4 w-4 text-red-400" /> Resting Heart Rate
                  </CardTitle>
                </CardHeader>
                <CardContent><HRChart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.breathingRate != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Wind className="h-4 w-4 text-teal-400" /> Breathing Rate
                  </CardTitle>
                </CardHeader>
                <CardContent><BreathingRateChart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.spo2 != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Wind className="h-4 w-4 text-cyan-400" /> Blood Oxygen SpO₂
                  </CardTitle>
                </CardHeader>
                <CardContent><SpO2Chart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.weight != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Scale className="h-4 w-4 text-blue-400" /> Weight
                  </CardTitle>
                </CardHeader>
                <CardContent><WeightChart data={chartData} /></CardContent>
              </Card>
            )}

            {chartData.some(d => d.mood != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <span>😊</span> Mood
                  </CardTitle>
                </CardHeader>
                <CardContent><MoodChart data={chartData} /></CardContent>
              </Card>
            )}

          </div>

          {/* ── recent log ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Recent entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {logs.slice(0, 10).map(log => (
                  <div key={log.id} className="flex items-center justify-between px-4 py-2.5 text-sm min-w-0">
                    <span className="text-muted-foreground w-20 shrink-0 text-xs">{format(log.date, "EEE MMM d")}</span>
                    <div className="flex items-center gap-3 flex-1 justify-end flex-wrap min-w-0 overflow-hidden">
                      {log.readinessScore != null && (
                        <span className={`flex items-center gap-1 text-xs ${readinessColor(log.readinessScore)}`}>
                          <Shield className="h-3 w-3" />{log.readinessScore}
                        </span>
                      )}
                      {log.activityScore != null && (
                        <span className={`flex items-center gap-1 text-xs ${scoreColor(log.activityScore)}`}>
                          <Zap className="h-3 w-3" />{log.activityScore}
                        </span>
                      )}
                      {log.sleepDuration != null && (
                        <span className="flex items-center gap-1 text-primary">
                          <Moon className="h-3 w-3" />{(log.sleepDuration / 60).toFixed(1)}h
                        </span>
                      )}
                      {log.steps != null && (
                        <span className="flex items-center gap-1 text-green-400">
                          <Footprints className="h-3 w-3" />{log.steps.toLocaleString()}
                        </span>
                      )}
                      {log.restingHR != null && (
                        <span className="flex items-center gap-1 text-red-400">
                          <Heart className="h-3 w-3" />{log.restingHR}
                        </span>
                      )}
                      {log.hrv != null && (
                        <span className="flex items-center gap-1 text-primary text-xs">
                          <Activity className="h-3 w-3" />{Math.round(log.hrv)}ms
                        </span>
                      )}
                      {log.spo2 != null && (
                        <span className="flex items-center gap-1 text-cyan-400 text-xs">
                          <Wind className="h-3 w-3" />{(log.spo2 as number).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Recent Workouts (Strava) ── */}
      {stravaActivities.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recent Workouts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {stravaActivities.map(activity => {
                const emoji =
                  activity.type === "Run"           ? "🏃" :
                  activity.type === "Ride"          ? "🚴" :
                  activity.type === "WeightTraining"? "🏋️" :
                  activity.type === "Walk"          ? "🚶" :
                  activity.type === "Swim"          ? "🏊" :
                  activity.type === "Yoga"          ? "🧘" :
                  "💪"
                const distKm = activity.distanceM != null
                  ? (activity.distanceM / 1000).toFixed(2) + " km"
                  : null
                const totalSec = activity.movingTimeSec
                const hours = Math.floor(totalSec / 3600)
                const mins = Math.floor((totalSec % 3600) / 60)
                const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
                return (
                  <div key={activity.id} className="flex items-center justify-between px-4 py-2.5 text-sm min-w-0">
                    <span className="text-muted-foreground w-20 shrink-0 text-xs">
                      {format(new Date(activity.startDate), "EEE MMM d")}
                    </span>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="shrink-0">{emoji}</span>
                      <span className="font-medium truncate min-w-0">{activity.name ?? activity.type}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                      {distKm && <span className="hidden sm:inline">{distKm}</span>}
                      <span>{duration}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SummaryCard({ icon, label, value, good, target, delta }: {
  icon: React.ReactNode; label: string; value: string; good?: boolean; target?: string
  delta?: { text: string; good: boolean | null } | null
}) {
  return (
    <Card className={good ? "border-green-500/30" : ""}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{label}</div>
        <p className={`text-lg font-bold ${good ? "text-green-400" : ""}`}>{value}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {target && <p className="text-[10px] text-muted-foreground">{target}</p>}
          {delta && (
            <p className={`text-[10px] font-semibold ${
              delta.good == null ? "text-muted-foreground" : delta.good ? "text-green-400" : "text-red-400"}`}>
              {delta.text}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// SVG progress ring for a 0–100 score; color follows the usual score bands.
function ScoreRing({ label, score, sub }: { label: string; score: number | null; sub?: string }) {
  const R = 34, C = 2 * Math.PI * R
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0
  const color = score == null ? "#3f3f46" : score >= 85 ? "#4ade80" : score >= 70 ? "#fbbf24" : "#f87171"
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: 84, height: 84 }}>
        <svg width={84} height={84} viewBox="0 0 84 84" className="-rotate-90">
          <circle cx={42} cy={42} r={R} fill="none" strokeWidth={7} className="stroke-secondary" />
          <circle cx={42} cy={42} r={R} fill="none" strokeWidth={7} stroke={color} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-black" style={{ color }}>{score != null ? Math.round(score) : "—"}</span>
        </div>
      </div>
      <p className="text-xs font-medium">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground -mt-1">{sub}</p>}
    </div>
  )
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  )
}
