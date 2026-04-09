import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { HealthEntryForm } from "@/components/health/HealthEntryForm"
import { ExistSyncButton } from "@/components/health/ExistSyncButton"
import {
  SleepChart, StepsChart, HRChart, WeightChart, ActivityChart,
  type ChartDay,
} from "@/components/health/HealthCharts"
import { Moon, Footprints, Heart, Scale, Zap, Activity, Coffee, Droplets } from "lucide-react"
import { format, subDays } from "date-fns"

const STEP_GOAL = 8_000
const SLEEP_GOAL_H = 7

export default async function HealthPage() {
  const session = await auth()
  const userId = session!.user.id

  // Fetch 30 days for charts; only select existing DB columns
  const logs = await prisma.healthLog.findMany({
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
    },
  })

  // ── Averages (last 7 days) ───────────────────────────────────────────────────
  const recent7 = logs.slice(0, 7)
  function avg(arr: (number | null)[]) {
    const vals = arr.filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  const avgSleepMin = avg(recent7.map(l => l.sleepDuration))
  const avgSteps = avg(recent7.map(l => l.steps))
  const avgHR = avg(recent7.map(l => l.restingHR))
  const avgWeight = avg(recent7.map(l => l.weight))
  const avgActiveMins = avg(recent7.map(l => l.activeMinutes))

  // ── Chart data ───────────────────────────────────────────────────────────────
  const chartData: ChartDay[] = logs.map(l => ({
    date: format(l.date, "MMM d"),
    sleepH: l.sleepDuration != null ? Math.round((l.sleepDuration / 60) * 10) / 10 : null,
    deepMin: l.deepSleep ?? null,
    remMin: l.remSleep ?? null,
    lightMin: l.lightSleep ?? null,
    steps: l.steps ?? null,
    restingHR: l.restingHR ?? null,
    weight: l.weight ?? null,
    activeMin: l.activeMinutes ?? null,
    calories: l.caloriesBurned ?? null,
  }))

  const latestLog = logs[0] ?? null

  return (
    <div className="space-y-6">
      {/* ── header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Health</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {logs.length} days of data · synced from exist.io
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!!process.env.EXIST_IO_TOKEN && <ExistSyncButton />}
          <HealthEntryForm />
        </div>
      </div>

      {logs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Moon className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No health data yet</p>
            <p className="text-sm text-muted-foreground mt-1">Sync from exist.io or click &quot;Log Day&quot;</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── 7-day summary ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <SummaryCard
              icon={<Moon className="h-4 w-4 text-indigo-400" />}
              label="Avg sleep"
              value={avgSleepMin != null ? `${(avgSleepMin / 60).toFixed(1)}h` : "—"}
              good={avgSleepMin != null && avgSleepMin / 60 >= SLEEP_GOAL_H}
              target={`goal ${SLEEP_GOAL_H}h`}
            />
            <SummaryCard
              icon={<Footprints className="h-4 w-4 text-green-400" />}
              label="Avg steps"
              value={avgSteps != null ? Math.round(avgSteps).toLocaleString() : "—"}
              good={avgSteps != null && avgSteps >= STEP_GOAL}
              target={`goal ${STEP_GOAL.toLocaleString()}`}
            />
            <SummaryCard
              icon={<Heart className="h-4 w-4 text-red-400" />}
              label="Avg resting HR"
              value={avgHR != null ? `${Math.round(avgHR)} bpm` : "—"}
            />
            <SummaryCard
              icon={<Scale className="h-4 w-4 text-blue-400" />}
              label="Latest weight"
              value={avgWeight != null ? `${avgWeight.toFixed(1)} kg` : "—"}
            />
            <SummaryCard
              icon={<Zap className="h-4 w-4 text-amber-400" />}
              label="Avg active"
              value={avgActiveMins != null ? `${Math.round(avgActiveMins)} min` : "—"}
            />
          </div>

          {/* ── latest day detail ── */}
          {latestLog && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">
                    {format(latestLog.date, "EEEE, MMM d")} — latest
                  </CardTitle>
                  {latestLog.steps != null && (
                    <Badge variant={latestLog.steps >= STEP_GOAL ? "default" : "secondary"} className="text-xs">
                      {latestLog.steps >= STEP_GOAL ? "Step goal ✓" : "Step goal missed"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatBox icon={<Moon className="h-4 w-4 text-indigo-400" />} label="Sleep"
                    value={latestLog.sleepDuration != null ? `${(latestLog.sleepDuration / 60).toFixed(1)}h` : "—"} />
                  <StatBox icon={<span className="text-sm">💤</span>} label="Deep / REM"
                    value={latestLog.deepSleep != null || latestLog.remSleep != null
                      ? `${latestLog.deepSleep ?? "?"}m / ${latestLog.remSleep ?? "?"}m` : "—"} />
                  {latestLog.lightSleep != null && (
                    <StatBox icon={<span className="text-sm">🌙</span>} label="Light sleep"
                      value={`${latestLog.lightSleep}m`} />
                  )}
                  <StatBox icon={<Footprints className="h-4 w-4 text-green-400" />} label="Steps"
                    value={latestLog.steps != null ? latestLog.steps.toLocaleString() : "—"} />
                  <StatBox icon={<Heart className="h-4 w-4 text-red-400" />} label="Resting HR"
                    value={latestLog.restingHR != null ? `${latestLog.restingHR} bpm` : "—"} />
                  <StatBox icon={<Scale className="h-4 w-4 text-blue-400" />} label="Weight"
                    value={(latestLog as any).weight != null ? `${(latestLog as any).weight} kg` : "—"} />
                  {latestLog.activeMinutes != null && (
                    <StatBox icon={<Activity className="h-4 w-4 text-amber-400" />} label="Active min"
                      value={`${latestLog.activeMinutes} min`} />
                  )}
                  {latestLog.caloriesBurned != null && (
                    <StatBox icon={<Zap className="h-4 w-4 text-orange-400" />} label="Calories"
                      value={`${latestLog.caloriesBurned} kcal`} />
                  )}
                </div>
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
              </CardContent>
            </Card>
          )}

          {/* ── charts ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Sleep */}
            {chartData.some(d => d.sleepH != null) && (
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Moon className="h-4 w-4 text-indigo-400" /> Sleep — last {Math.min(logs.length, 30)} days
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SleepChart data={chartData} />
                </CardContent>
              </Card>
            )}

            {/* Steps */}
            {chartData.some(d => d.steps != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Footprints className="h-4 w-4 text-green-400" /> Steps
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <StepsChart data={chartData} goal={STEP_GOAL} />
                </CardContent>
              </Card>
            )}

            {/* Activity */}
            {chartData.some(d => d.activeMin != null || d.calories != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-400" /> Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityChart data={chartData} />
                </CardContent>
              </Card>
            )}

            {/* Heart Rate */}
            {chartData.some(d => d.restingHR != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Heart className="h-4 w-4 text-red-400" /> Resting Heart Rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <HRChart data={chartData} />
                </CardContent>
              </Card>
            )}

            {/* Weight */}
            {chartData.some(d => d.weight != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Scale className="h-4 w-4 text-blue-400" /> Weight
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <WeightChart data={chartData} />
                </CardContent>
              </Card>
            )}

          </div>

          {/* ── coffee & water coming soon notice ── */}
          <Card className="border-dashed border-muted">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <Coffee className="h-5 w-5 text-amber-600 shrink-0" />
                <Droplets className="h-5 w-5 text-blue-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Coffee & Water tracking</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Run the SQL migration in <code className="text-xs bg-secondary px-1 rounded">prisma/add_health_columns.sql</code> in
                    your Neon SQL editor, then re-deploy to enable coffee ☕ and water 💧 from exist.io.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

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
                      {(log as any).weight != null && (
                        <span className="flex items-center gap-1 text-blue-400">
                          <Scale className="h-3 w-3" />{(log as any).weight}kg
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
