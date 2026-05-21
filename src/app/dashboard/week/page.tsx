import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { format, subDays, startOfWeek, endOfWeek } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  Moon, Footprints, Heart, Activity, Shield, Wind,
  CheckSquare, Flame, Droplets, Timer, TrendingUp, TrendingDown, Minus,
} from "lucide-react"

const STEP_GOAL = 8000
const SLEEP_GOAL_H = 7.5
const WATER_GOAL = 2000

function avg(arr: (number | null)[]) {
  const v = arr.filter((x): x is number => x != null)
  return v.length ? v.reduce((a,b) => a+b, 0) / v.length : null
}

function TrendArrow({ current, prev, higherIsBetter = true }: {
  current: number | null; prev: number | null; higherIsBetter?: boolean
}) {
  if (!current || !prev) return <Minus className="h-3 w-3 text-muted-foreground" />
  const pct = ((current - prev) / prev) * 100
  const up = pct > 1
  const down = pct < -1
  const good = higherIsBetter ? up : down
  if (!up && !down) return <Minus className="h-3 w-3 text-muted-foreground" />
  if (up) return <TrendingUp className={`h-3 w-3 ${good ? "text-green-400" : "text-red-400"}`} />
  return <TrendingDown className={`h-3 w-3 ${good ? "text-green-400" : "text-red-400"}`} />
}

export default async function WeekPage() {
  const session = await auth()
  const userId = session!.user.id

  const today = new Date()
  const weekStart = startOfWeek(today, { weekStartsOn: 1 })
  const prevWeekStart = subDays(weekStart, 7)
  const prevWeekEnd = subDays(weekStart, 1)

  const [thisWeekLogs, prevWeekLogs, thisWeekHabits, thisWeekIntake, thisWeekFocus, moodLogs] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: weekStart, lte: today } },
      orderBy: { date: "asc" },
      select: {
        date: true, sleepDuration: true, steps: true, restingHR: true,
        readinessScore: true, hrv: true, spo2: true, activityScore: true,
        activeMinutes: true, weight: true,
      },
    }),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: prevWeekStart, lte: prevWeekEnd } },
      orderBy: { date: "asc" },
      select: {
        sleepDuration: true, steps: true, readinessScore: true,
        hrv: true, activityScore: true,
      },
    }),
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      include: {
        completions: { where: { date: { gte: weekStart, lte: today } } },
      },
    }),
    prisma.intakeLog.findMany({
      where: { userId, type: "water", loggedAt: { gte: weekStart, lte: today } },
      select: { amountMl: true, loggedAt: true },
    }).catch(() => [] as any[]),
    prisma.focusSession.findMany({
      where: { userId, type: "focus", endedAt: { gte: weekStart, lte: today } },
      select: { durationMin: true },
    }).catch(() => [] as any[]),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: weekStart, lte: today } },
      orderBy: { date: "asc" },
    }),
  ])

  // Aggregate
  const daysInWeek = thisWeekLogs.length
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = subDays(today, 6 - i)
    return format(d, "yyyy-MM-dd")
  })

  const thisWeekAvg = {
    sleep: avg(thisWeekLogs.map(l => l.sleepDuration != null ? l.sleepDuration/60 : null)),
    steps: avg(thisWeekLogs.map(l => l.steps)),
    readiness: avg(thisWeekLogs.map(l => l.readinessScore)),
    hrv: avg(thisWeekLogs.map(l => l.hrv)),
    activityScore: avg(thisWeekLogs.map(l => l.activityScore)),
    restingHR: avg(thisWeekLogs.map(l => l.restingHR)),
    spo2: avg(thisWeekLogs.map(l => l.spo2)),
  }
  const prevWeekAvg = {
    sleep: avg(prevWeekLogs.map(l => l.sleepDuration != null ? l.sleepDuration/60 : null)),
    steps: avg(prevWeekLogs.map(l => l.steps)),
    readiness: avg(prevWeekLogs.map(l => l.readinessScore)),
    hrv: avg(prevWeekLogs.map(l => l.hrv)),
    activityScore: avg(prevWeekLogs.map(l => l.activityScore)),
  }

  // Habits
  const totalDays = Math.max(1, daysInWeek)
  const habitsStats = thisWeekHabits.map(h => ({
    name: h.name, color: h.color,
    completions: h.completions.length,
    pct: Math.round((h.completions.length / totalDays) * 100),
  })).sort((a,b) => b.pct - a.pct)
  const habitsCompletionRate = habitsStats.length > 0
    ? Math.round(habitsStats.reduce((s,h) => s + h.pct, 0) / habitsStats.length)
    : null

  // Intake
  const waterByDay: Record<string, number> = {}
  for (const w of thisWeekIntake) {
    const d = format(new Date(w.loggedAt), "yyyy-MM-dd")
    waterByDay[d] = (waterByDay[d] ?? 0) + w.amountMl
  }
  const waterGoalDays = Object.values(waterByDay).filter(v => v >= WATER_GOAL).length
  const totalWaterMl = Object.values(waterByDay).reduce((a,b) => a+b, 0)

  // Focus
  const totalFocusMin = thisWeekFocus.reduce((a: number, s: any) => a + s.durationMin, 0)

  // Mood
  const moodAvg = moodLogs.length ? moodLogs.reduce((s, m) => s + m.mood, 0) / moodLogs.length : null
  const moodEmoji = (m: number | null) => {
    if (!m) return "—"
    if (m >= 4.5) return "😄"
    if (m >= 3.5) return "🙂"
    if (m >= 2.5) return "😐"
    if (m >= 1.5) return "😕"
    return "😴"
  }

  const weekLabel = `${format(weekStart, "MMM d")} – ${format(today, "MMM d, yyyy")}`

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Weekly Review</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{weekLabel} · {daysInWeek} days of data</p>
      </div>

      {/* top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          icon={<Moon className="h-4 w-4 text-indigo-400" />} label="Avg sleep"
          value={thisWeekAvg.sleep != null ? `${thisWeekAvg.sleep.toFixed(1)}h` : "—"}
          ok={thisWeekAvg.sleep != null && thisWeekAvg.sleep >= SLEEP_GOAL_H}
          target={`goal ${SLEEP_GOAL_H}h`}
          trend={<TrendArrow current={thisWeekAvg.sleep} prev={prevWeekAvg.sleep} />}
        />
        <KpiCard
          icon={<Footprints className="h-4 w-4 text-green-400" />} label="Avg steps"
          value={thisWeekAvg.steps != null ? Math.round(thisWeekAvg.steps).toLocaleString() : "—"}
          ok={thisWeekAvg.steps != null && thisWeekAvg.steps >= STEP_GOAL}
          target={`goal ${STEP_GOAL.toLocaleString()}`}
          trend={<TrendArrow current={thisWeekAvg.steps} prev={prevWeekAvg.steps} />}
        />
        <KpiCard
          icon={<Shield className="h-4 w-4 text-emerald-400" />} label="Avg readiness"
          value={thisWeekAvg.readiness != null ? Math.round(thisWeekAvg.readiness).toString() : "—"}
          ok={thisWeekAvg.readiness != null && thisWeekAvg.readiness >= 70}
          trend={<TrendArrow current={thisWeekAvg.readiness} prev={prevWeekAvg.readiness} />}
        />
        <KpiCard
          icon={<Activity className="h-4 w-4 text-violet-400" />} label="Avg HRV"
          value={thisWeekAvg.hrv != null ? `${Math.round(thisWeekAvg.hrv)}ms` : "—"}
          trend={<TrendArrow current={thisWeekAvg.hrv} prev={prevWeekAvg.hrv} />}
        />
      </div>

      {/* daily breakdown grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Daily breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left pb-2 font-medium">Day</th>
                  <th className="text-right pb-2 font-medium">Sleep</th>
                  <th className="text-right pb-2 font-medium">Steps</th>
                  <th className="text-right pb-2 font-medium">Readiness</th>
                  <th className="text-right pb-2 font-medium">Activity</th>
                  <th className="text-right pb-2 font-medium">HR</th>
                  <th className="text-right pb-2 font-medium">Mood</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {thisWeekLogs.map(l => {
                  const dateStr = format(l.date, "yyyy-MM-dd")
                  const mood = moodLogs.find(m => m.date.toISOString().startsWith(dateStr))?.mood ?? null
                  return (
                    <tr key={dateStr} className="hover:bg-secondary/30">
                      <td className="py-2 font-medium">{format(l.date, "EEE d")}</td>
                      <td className={`text-right py-2 ${l.sleepDuration != null && l.sleepDuration/60 >= SLEEP_GOAL_H ? "text-green-400" : "text-muted-foreground"}`}>
                        {l.sleepDuration != null ? `${(l.sleepDuration/60).toFixed(1)}h` : "—"}
                      </td>
                      <td className={`text-right py-2 ${l.steps != null && l.steps >= STEP_GOAL ? "text-green-400" : "text-muted-foreground"}`}>
                        {l.steps != null ? l.steps.toLocaleString() : "—"}
                      </td>
                      <td className={`text-right py-2 ${l.readinessScore != null && l.readinessScore >= 70 ? "text-green-400" : l.readinessScore != null && l.readinessScore < 50 ? "text-red-400" : "text-muted-foreground"}`}>
                        {l.readinessScore ?? "—"}
                      </td>
                      <td className={`text-right py-2 ${l.activityScore != null && l.activityScore >= 70 ? "text-green-400" : "text-muted-foreground"}`}>
                        {l.activityScore ?? "—"}
                      </td>
                      <td className="text-right py-2 text-muted-foreground">
                        {l.restingHR != null ? `${l.restingHR}bpm` : "—"}
                      </td>
                      <td className="text-right py-2">{mood ? moodEmoji(mood) : "—"}</td>
                    </tr>
                  )
                })}
                {thisWeekLogs.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No data for this week yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* lifestyle row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* habits */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <CheckSquare className="h-4 w-4 text-amber-400" /> Habits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {habitsStats.length === 0 ? (
              <p className="text-xs text-muted-foreground">No habits tracked</p>
            ) : (
              <>
                {habitsCompletionRate != null && (
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Avg completion</span>
                      <span className={habitsCompletionRate >= 80 ? "text-green-400 font-semibold" : ""}>{habitsCompletionRate}%</span>
                    </div>
                    <Progress value={habitsCompletionRate} className="h-1.5" />
                  </div>
                )}
                {habitsStats.map(h => (
                  <div key={h.name} className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
                    <span className="text-xs flex-1 truncate">{h.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{h.completions}/{totalDays}d</span>
                    <span className={`text-[10px] shrink-0 font-medium ${h.pct >= 80 ? "text-green-400" : h.pct >= 50 ? "text-amber-400" : "text-red-400"}`}>
                      {h.pct}%
                    </span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* water */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Droplets className="h-4 w-4 text-blue-400" /> Hydration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-center">
              <p className="text-2xl font-black text-blue-400">
                {totalWaterMl >= 1000 ? `${(totalWaterMl/1000).toFixed(1)}L` : `${totalWaterMl}ml`}
              </p>
              <p className="text-xs text-muted-foreground">total this week</p>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1 text-muted-foreground">
                <span>Goal days ({WATER_GOAL/1000}L+)</span>
                <span>{waterGoalDays}/{totalDays}</span>
              </div>
              <Progress value={totalDays > 0 ? (waterGoalDays/totalDays)*100 : 0} className="h-1.5" />
            </div>
            {totalWaterMl === 0 && (
              <p className="text-xs text-muted-foreground">Log water on the Intake page to track here</p>
            )}
          </CardContent>
        </Card>

        {/* focus */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Timer className="h-4 w-4 text-indigo-400" /> Focus
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-center">
              <p className="text-2xl font-black text-indigo-400">
                {totalFocusMin >= 60 ? `${(totalFocusMin/60).toFixed(1)}h` : `${totalFocusMin}m`}
              </p>
              <p className="text-xs text-muted-foreground">deep work this week</p>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1 text-muted-foreground">
                <span>Daily avg</span>
                <span>{totalDays > 0 ? Math.round(totalFocusMin/totalDays) : 0}min/day</span>
              </div>
              <Progress value={Math.min(100, (totalFocusMin / (totalDays * 90)) * 100)} className="h-1.5" />
            </div>
            {totalFocusMin === 0 && (
              <p className="text-xs text-muted-foreground">Use the Focus timer to log sessions</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* mood for the week */}
      {moodLogs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Mood this week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-center">
                <p className="text-3xl">{moodEmoji(moodAvg)}</p>
                <p className="text-sm font-bold">{moodAvg?.toFixed(1)}<span className="text-xs text-muted-foreground">/5</span></p>
                <p className="text-[10px] text-muted-foreground">avg mood</p>
              </div>
              <div className="flex-1 flex items-end gap-2">
                {moodLogs.map(m => {
                  const MOOD_COLORS = ["","bg-red-500","bg-orange-500","bg-yellow-500","bg-green-500","bg-emerald-500"]
                  return (
                    <div key={m.id} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`w-full rounded-sm ${MOOD_COLORS[m.mood]}`}
                        style={{ height: `${m.mood * 12}px` }} />
                      <span className="text-[9px] text-muted-foreground">{format(m.date, "EEE")}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function KpiCard({ icon, label, value, ok, target, trend }: {
  icon: React.ReactNode; label: string; value: string; ok?: boolean; target?: string; trend?: React.ReactNode
}) {
  return (
    <Card className={ok ? "border-green-500/20" : ""}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
          {trend}
        </div>
        <p className={`text-xl font-bold ${ok ? "text-green-400" : ""}`}>{value}</p>
        {target && <p className="text-[10px] text-muted-foreground mt-0.5">{target}</p>}
      </CardContent>
    </Card>
  )
}
