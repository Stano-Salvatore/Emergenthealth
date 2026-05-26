import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { HealthEntryForm } from "@/components/health/HealthEntryForm"
import { OuraSyncButton } from "@/components/health/OuraSyncButton"
import {
  SleepChart, StepsChart, HRChart, WeightChart, ActivityChart,
  ReadinessChart, HRVChart, SpO2Chart, ActivityScoreChart,
  StressRecoveryChart, BreathingRateChart, MoodChart,
  type ChartDay,
} from "@/components/health/HealthCharts"
import { Moon, Footprints, Heart, Scale, Zap, Activity, Thermometer, Wind, Shield } from "lucide-react"
import { format, subDays } from "date-fns"

interface StravaActivityRow {
  id: string
  type: string
  name: string | null
  distanceM: number | null
  movingTimeSec: number
  startDate: Date
  day: string
}

const STEP_GOAL = 8_000
const SLEEP_GOAL_H = 7

export default async function HealthPage() {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id

  const ouraToken = await prisma.ouraToken.findUnique({ where: { userId }, select: { id: true } })
  const isOuraConnected = !!ouraToken

  // Recent Strava activities — table may not exist yet
  const since14str = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const stravaActivities = await prisma.$queryRaw<StravaActivityRow[]>`
    SELECT "id", "type", "name", "distanceM", "movingTimeSec", "startDate", "day"
    FROM "StravaActivity"
    WHERE "userId" = ${userId}
      AND "day" >= ${since14str}
    ORDER BY "startDate" DESC
    LIMIT 30
  `.catch(() => [] as StravaActivityRow[])

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Health</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {logs.length} days of data · synced from Oura Ring
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOuraConnected && <OuraSyncButton />}
          <HealthEntryForm />
        </div>
      </div>

      {logs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Moon className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No health data yet</p>
            <p className="text-sm text-muted-foreground mt-1">Connect your Oura Ring in Settings and sync, or click &quot;Log Day&quot;</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── 7-day summary ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-10 gap-3">
            <SummaryCard icon={<Moon className="h-4 w-4 text-indigo-400" />} label="Sleep score"
              value={avgSleepScore != null ? `${Math.round(avgSleepScore)}` : "—"}
              good={avgSleepScore != null && avgSleepScore >= 85} target="goal 85+" />
            <SummaryCard icon={<Moon className="h-4 w-4 text-indigo-400" />} label="Avg sleep"
              value={avgSleepMin != null ? `${(avgSleepMin / 60).toFixed(1)}h` : "—"}
              good={avgSleepMin != null && avgSleepMin / 60 >= SLEEP_GOAL_H} target={`goal ${SLEEP_GOAL_H}h`} />
            <SummaryCard icon={<Footprints className="h-4 w-4 text-green-400" />} label="Avg steps"
              value={avgSteps != null ? Math.round(avgSteps).toLocaleString() : "—"}
              good={avgSteps != null && avgSteps >= STEP_GOAL} target={`goal ${STEP_GOAL.toLocaleString()}`} />
            <SummaryCard icon={<Heart className="h-4 w-4 text-red-400" />} label="Avg resting HR"
              value={avgHR != null ? `${Math.round(avgHR)} bpm` : "—"} />
            <SummaryCard icon={<Scale className="h-4 w-4 text-blue-400" />} label="Latest weight"
              value={avgWeight != null ? `${avgWeight.toFixed(1)} kg` : "—"} />
            <SummaryCard icon={<Zap className="h-4 w-4 text-amber-400" />} label="Avg active"
              value={avgActiveMins != null ? `${Math.round(avgActiveMins)} min` : "—"} />
            <SummaryCard icon={<Shield className="h-4 w-4 text-emerald-400" />} label="Avg readiness"
              value={avgReadiness != null ? `${Math.round(avgReadiness)}` : "—"}
              good={avgReadiness != null && avgReadiness >= 70} target="goal 70+" />
            <SummaryCard icon={<Activity className="h-4 w-4 text-violet-400" />} label="Avg HRV"
              value={avgHRV != null ? `${Math.round(avgHRV)} ms` : "—"} />
            <SummaryCard icon={<Wind className="h-4 w-4 text-cyan-400" />} label="Avg SpO₂"
              value={avgSpo2 != null ? `${avgSpo2.toFixed(1)}%` : "—"}
              good={avgSpo2 != null && avgSpo2 >= 95} />
            <SummaryCard icon={<Zap className="h-4 w-4 text-amber-300" />} label="Avg activity"
              value={avgActivityScore != null ? `${Math.round(avgActivityScore)}` : "—"}
              good={avgActivityScore != null && avgActivityScore >= 70} target="goal 70+" />
          </div>

          {/* ── latest day detail ── */}
          {latestLog && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">
                    {format(latestLog.date, "EEEE, MMM d")} — latest
                  </CardTitle>
                  <div className="flex items-center gap-2">
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
                    <StatBox icon={<Moon className="h-4 w-4 text-indigo-400" />} label="Sleep"
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
                      <StatBox icon={<Activity className="h-4 w-4 text-violet-400" />} label="HRV"
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {chartData.some(d => d.sleepH != null) && (
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Moon className="h-4 w-4 text-indigo-400" /> Sleep — last {Math.min(logs.length, 30)} days
                  </CardTitle>
                </CardHeader>
                <CardContent><SleepChart data={chartData} /></CardContent>
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
                    <Activity className="h-4 w-4 text-violet-400" /> HRV
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
                  <div key={log.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-muted-foreground w-20 shrink-0">{format(log.date, "EEE MMM d")}</span>
                    <div className="flex items-center gap-4 flex-1 justify-end flex-wrap">
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
                        <span className="flex items-center gap-1 text-indigo-400">
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
                        <span className="flex items-center gap-1 text-violet-400 text-xs">
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
                  <div key={activity.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-muted-foreground w-20 shrink-0 text-xs">
                      {format(new Date(activity.startDate), "EEE MMM d")}
                    </span>
                    <div className="flex items-center gap-2 flex-1">
                      <span>{emoji}</span>
                      <span className="font-medium truncate">{activity.name ?? activity.type}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      {distKm && <span>{distKm}</span>}
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

function SummaryCard({ icon, label, value, good, target }: {
  icon: React.ReactNode; label: string; value: string; good?: boolean; target?: string
}) {
  return (
    <Card className={good ? "border-green-500/30" : ""}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{label}</div>
        <p className={`text-lg font-bold ${good ? "text-green-400" : ""}`}>{value}</p>
        {target && <p className="text-[10px] text-muted-foreground mt-0.5">{target}</p>}
      </CardContent>
    </Card>
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
