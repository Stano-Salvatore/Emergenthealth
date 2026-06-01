import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUpcomingEvents } from "@/lib/google-calendar"
import { getGmailSummary } from "@/lib/gmail"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import Link from "next/link"
import {
  Activity, Euro, Calendar, CheckSquare, Bell, Moon,
  Footprints, ChevronRight, Heart, Clock,
  TrendingUp, TrendingDown, Mail, Shield,
  Wind, Flame, Droplets, Timer,
} from "lucide-react"
import { format, isToday, isTomorrow, parseISO, isBefore } from "date-fns"
import { LiveClock } from "@/components/dashboard/LiveClock"
import { WeatherWidget } from "@/components/dashboard/WeatherWidget"
import { AcCard } from "@/components/dashboard/AcCard"
import { MoodWidget } from "@/components/dashboard/MoodWidget"
import { QuickLog } from "@/components/dashboard/QuickLog"
import { LocationCard } from "@/components/dashboard/LocationCard"

import { ReconnectGoogleButton } from "@/components/ui/ReconnectGoogleButton"
import { DashboardGrid } from "@/components/dashboard/DashboardGrid"
import { QuickHabits } from "@/components/dashboard/QuickHabits"
import { PlaceDetector } from "@/components/dashboard/PlaceDetector"
import { InsightCard } from "@/components/dashboard/InsightCard"
import { TodayCard } from "@/components/dashboard/TodayCard"
import { DailyQuests } from "@/components/dashboard/DailyQuests"

const STEP_GOAL = 8_000
const SLEEP_GOAL_H = 7

function getTimeGreeting() {
  const h = new Date().getHours()
  if (h < 12) return "morning"
  if (h < 18) return "afternoon"
  return "evening"
}

function MiniMonthCalendar({
  year, month, todayDate, eventDays,
}: {
  year: number; month: number; todayDate: number; eventDays: Set<string>
}) {
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  const mm = String(month + 1).padStart(2, "0")
  return (
    <div className="flex-shrink-0 select-none">
      <div className="grid grid-cols-7">
        {["M","T","W","T","F","S","S"].map((d,i) => (
          <div key={i} className={`w-7 text-center text-[9px] font-semibold pb-1 ${i===6?"text-red-400/70":"text-muted-foreground"}`}>{d}</div>
        ))}
      </div>
      {rows.map((row,ri) => (
        <div key={ri} className="grid grid-cols-7">
          {row.map((day,di) => {
            if (!day) return <div key={di} className="w-7 h-7" />
            const isCurrentDay = day===todayDate
            const isSunday = di===6
            const dd = String(day).padStart(2,"0")
            const hasEvent = eventDays.has(`${year}-${mm}-${dd}`)
            return (
              <div key={di} className="w-7 h-7 flex items-center justify-center relative">
                <span className={["text-[11px] leading-none flex items-center justify-center",isCurrentDay?"bg-foreground text-background rounded-full h-5 w-5 font-bold":isSunday?"text-red-400":"text-foreground/80"].join(" ")}>{day}</span>
                {hasEvent && <div className={`absolute bottom-0 h-[3px] w-[3px] rounded-full ${isCurrentDay?"bg-background":"bg-primary"}`} />}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Wellness Score ─────────────────────────────────────────────────────────────
function computeWellnessScore({
  sleepMin, steps, readiness, habitsRatio,
}: {
  sleepMin: number | null
  steps: number | null
  readiness: number | null
  habitsRatio: number
}): { score: number; components: { label: string; pts: number; max: number }[] } {
  const sleepPts = sleepMin != null ? Math.min(25, Math.round((sleepMin / (SLEEP_GOAL_H * 60)) * 25)) : 0
  const stepsPts = steps != null ? Math.min(25, Math.round((steps / STEP_GOAL) * 25)) : 0
  const readinessPts = readiness != null ? Math.min(25, Math.round((readiness / 100) * 25)) : 0
  const habitsPts = Math.round(habitsRatio * 25)
  return {
    score: sleepPts + stepsPts + readinessPts + habitsPts,
    components: [
      { label: "Sleep", pts: sleepPts, max: 25 },
      { label: "Steps", pts: stepsPts, max: 25 },
      { label: "Readiness", pts: readinessPts, max: 25 },
      { label: "Habits", pts: habitsPts, max: 25 },
    ],
  }
}

function scoreGrade(s: number) {
  if (s >= 85) return { label: "Excellent", color: "text-emerald-400", emoji: "🌟" }
  if (s >= 70) return { label: "Good", color: "text-green-400", emoji: "✨" }
  if (s >= 50) return { label: "Fair", color: "text-amber-400", emoji: "🌤️" }
  return { label: "Low", color: "text-red-400", emoji: "💤" }
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id

  // Provision columns added after initial deploy (safe no-op if already exist)
  await prisma.$executeRaw`ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "sleepScore" INTEGER`

  const now = new Date()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const todayStr = today.toISOString().split("T")[0]
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  const todayStart = new Date(todayStr + "T00:00:00.000Z")
  const todayEnd = new Date(todayStr + "T23:59:59.999Z")

  const todayCheckin = await prisma.$queryRaw<{id: string}[]>`
    SELECT "id" FROM "MorningCheckIn" WHERE "userId" = ${userId}
    AND "date" = ${todayStr} LIMIT 1
  `.catch(() => [] as {id: string}[])
  const hasCheckedInToday = todayCheckin.length > 0

  const [healthLogs, habits, reminders, transactions, calendarEvents, todayMoodLogs, gmailData, todayIntake, todayFocus, todayOuraTags] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 7,
      select: {
        id: true, date: true,
        sleepDuration: true, deepSleep: true, remSleep: true,
        steps: true, restingHR: true, weight: true,
        readinessScore: true, hrv: true, spo2: true,
        activeMinutes: true, caloriesBurned: true, activityScore: true,
        sleepScore: true, syncedAt: true,
      },
    }),
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      include: {
        completions: { where: { date: { gte: weekAgo } }, orderBy: { date: "desc" } },
      },
    }),
    prisma.reminder.findMany({
      where: { userId, isCompleted: false },
      orderBy: [{ dueDate: "asc" }],
      take: 10,
    }),
    prisma.transaction.findMany({
      where: { userId, date: { gte: monthStart }, isTransfer: false },
    }),
    getUpcomingEvents(userId, 14),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: today } },
      take: 1,
    }),
    getGmailSummary(userId),
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: todayStart, lte: todayEnd } },
    }).catch(() => [] as any[]),
    prisma.focusSession.findMany({
      where: { userId, endedAt: { gte: todayStart, lte: todayEnd }, type: "focus" },
    }).catch(() => [] as any[]),
    prisma.$queryRaw<{ tagName: string | null; text: string | null }[]>`
      SELECT "tagName", "text" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "day" = ${todayStr}
    `.catch(() => [] as any[]),
  ])

  // ── intake (manual logs + Oura ring drink tags)
  const manualWaterMl = todayIntake.filter((l: any) => l.type === "water").reduce((a: number, l: any) => a + l.amountMl, 0)
  const manualCoffeeMl = todayIntake.filter((l: any) => l.type === "coffee").reduce((a: number, l: any) => a + l.amountMl, 0)
  const focusMinToday = todayFocus.reduce((a: number, s: any) => a + s.durationMin, 0)

  // Classify today's Oura tags into drink types / meds
  const ML_RE = /(\d+)\s*ml/i
  // Default volumes for tags without an explicit ml amount
  const OURA_DEFAULTS: [RegExp, number][] = [
    [/espresso/,              30],
    [/macchiato/,             60],
    [/flat.?white/,          160],
    [/cappuccino/,           180],
    [/latte/,                300],
    [/americano/,            200],
    [/v60|aeropress|pour.?over/, 300],
    [/coffee/,               200],
    [/\bwater\b/,            300],
  ]
  function ouraDefaultMl(label: string): number {
    for (const [re, ml] of OURA_DEFAULTS) { if (re.test(label)) return ml }
    return 200
  }
  let ouraWaterMl = 0, ouraCoffeeMl = 0
  const todayMedTags: string[] = []
  const seenMedNames = new Set<string>()

  for (const t of (todayOuraTags as any[])) {
    // Combine tagName + text so "Espresso" + "30ml" → "Espresso 30ml"
    const label = [t.tagName, t.text].filter(Boolean).join(" ").trim().toLowerCase()
    if (!label) continue
    const mlMatch = label.match(ML_RE)
    const ml = mlMatch ? parseInt(mlMatch[1]) : ouraDefaultMl(label)
    if (/\bwater\b/.test(label)) { ouraWaterMl += ml }
    else if (/coffee|espresso|cappuccino|latte|americano|v60|aeropress|pour.?over|flat.?white|macchiato/.test(label)) { ouraCoffeeMl += ml }
    else if (!/beer|wine|\balcohol\b|spirit|cocktail|whisky|whiskey|vodka|rum|\bgin\b|cider|juice|smoothie|shake|soda/.test(label)) {
      // likely a medication or supplement — show name (de-duped, Title Case)
      const name = (t.tagName ?? t.text ?? "").trim()
      if (name && !seenMedNames.has(name.toLowerCase())) {
        seenMedNames.add(name.toLowerCase())
        todayMedTags.push(name)
      }
    }
  }

  const waterMl = manualWaterMl + ouraWaterMl
  const coffeeMl = manualCoffeeMl + ouraCoffeeMl

  // ── health
  const latestHealth = healthLogs[0] ?? null
  const sleepLogs = healthLogs.filter(l => l.sleepDuration != null)
  const sleepAvg = sleepLogs.length ? sleepLogs.reduce((s,l) => s+l.sleepDuration!,0)/sleepLogs.length : null
  const stepsLogs = healthLogs.filter(l => l.steps != null)
  const stepsAvg = stepsLogs.length ? stepsLogs.reduce((s,l) => s+l.steps!,0)/stepsLogs.length : null

  // ── finances
  const spending = transactions.filter(t => t.amount < 0)
  const incomeT = transactions.filter(t => t.amount > 0)
  const totalSpent = spending.reduce((s,t) => s+Math.abs(t.amount),0)
  const totalIncome = incomeT.reduce((s,t) => s+t.amount,0)
  const net = totalIncome - totalSpent
  const byCategory = spending.reduce((acc,t) => {
    const c = t.category ?? "Uncategorized"
    acc[c] = (acc[c]??0)+Math.abs(t.amount)
    return acc
  },{} as Record<string,number>)
  const topCategories = Object.entries(byCategory).sort(([,a],[,b])=>b-a).slice(0,4)
  const maxCat = topCategories[0]?.[1]??1

  // ── habits
  const habitsWithStreaks = habits.map(h => {
    const dates = new Set(h.completions.map(c => c.date.toISOString().split("T")[0]))
    let streak = 0
    const cursor = new Date(today)
    while (dates.has(cursor.toISOString().split("T")[0])) { streak++; cursor.setDate(cursor.getDate()-1) }
    return { ...h, streak, completedToday: dates.has(todayStr) }
  })
  const doneToday = habitsWithStreaks.filter(h => h.completedToday).length

  // ── reminders
  const overdueReminders = reminders.filter(r => r.dueDate && isBefore(r.dueDate, new Date()))
  const dueToday = reminders.filter(r => r.dueDate && isToday(r.dueDate))
  const upcomingR = reminders.filter(r => !r.dueDate || (!isBefore(r.dueDate, new Date()) && !isToday(r.dueDate)))

  // ── calendar
  function parseEDay(e: { start: string|null; isAllDay: boolean }) {
    if (!e.start) return null
    try { return e.isAllDay ? new Date(e.start+"T00:00:00") : parseISO(e.start) } catch { return null }
  }
  const todayEvents = calendarEvents.filter(e => { const d=parseEDay(e); return d && isToday(d) })
  const nextEvents = calendarEvents.filter(e => { const d=parseEDay(e); return d && !isToday(d) }).slice(0,4)
  const eventDays = new Set(calendarEvents.map(e => { try { const d=parseEDay(e); return d?format(d,"yyyy-MM-dd"):"" } catch { return "" }}).filter(Boolean))

  // ── mood
  const todayMood = todayMoodLogs[0]?.mood ?? null

  // ── wellness score
  const { score: wellnessScore, components: scoreComponents } = computeWellnessScore({
    sleepMin: latestHealth?.sleepDuration ?? null,
    steps: latestHealth?.steps ?? null,
    readiness: latestHealth?.readinessScore ?? null,
    habitsRatio: habits.length > 0 ? doneToday / habits.length : 0,
  })
  const { label: scoreLabel, color: scoreColor, emoji: scoreEmoji } = scoreGrade(wellnessScore)

  const header = (
    <>
      {/* ── header ── */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-primary/15 via-primary/5 to-background border border-primary/20 p-5">
        <div className="absolute -top-12 -right-12 w-56 h-56 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 left-1/3 w-40 h-40 bg-primary/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute top-2 right-1/3 w-24 h-24 bg-primary/8 rounded-full blur-2xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 relative">
          <div>
            <h1 className="text-2xl font-bold">
              Good {getTimeGreeting()}, {session!.user.name?.split(" ")[0] ?? "there"}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">{format(now,"EEEE, MMMM d, yyyy")}</p>
            <div className="mt-1"><LiveClock /></div>
          </div>
          <WeatherWidget />
        </div>
        <div className="mt-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 bg-background/50 backdrop-blur rounded-xl px-4 py-2.5 border border-white/8">
            <div className="text-center">
              <p className="text-2xl leading-none mb-0.5">{scoreEmoji}</p>
              <p className={`text-3xl font-black leading-none ${scoreColor}`}>{wellnessScore}</p>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${scoreColor}`}>{scoreLabel}</p>
            </div>
            <div className="h-10 w-px bg-border" />
            <div className="grid grid-cols-4 gap-3">
              {scoreComponents.map(c => (
                <div key={c.label} className="text-center">
                  <p className="text-sm font-bold">{c.pts}<span className="text-[10px] text-muted-foreground">/{c.max}</span></p>
                  <p className="text-[9px] text-muted-foreground">{c.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[200px] bg-background/50 backdrop-blur rounded-xl px-4 py-2 border border-white/8">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">How do you feel?</p>
            <MoodWidget todayMood={todayMood} />
          </div>
        </div>
      </div>

      {!hasCheckedInToday && (
        <Link href="/dashboard/checkin" className="block">
          <Card className="border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
            <CardContent className="pt-4 pb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">🌅 Morning check-in</p>
                <p className="text-xs text-muted-foreground mt-0.5">Log your energy, mood, and focus for today — takes 10 seconds</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      <PlaceDetector />

      <InsightCard />

      {/* ── today's schedule strip ── */}
      {todayEvents.length > 0 && (
        <div className="rounded-xl border bg-primary/5 border-primary/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">Today&apos;s Schedule</span>
            <Badge variant="secondary" className="text-xs">{todayEvents.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {todayEvents.map(e => (
              <div key={e.id} className="flex items-center gap-2 bg-background/60 rounded-lg px-3 py-1.5 border">
                <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                <span className="text-sm font-medium">{e.title}</span>
                {e.start && !e.isAllDay && (
                  <span className="text-xs text-muted-foreground">{format(parseISO(e.start),"h:mm a")}</span>
                )}
                {e.isAllDay && <span className="text-xs text-muted-foreground">all day</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )

  const blocks = {
    today: <TodayCard />,

    health: (
      <Link href="/dashboard/health" className="block h-full">
        <Card className="card-health hover:border-primary/40 transition-all cursor-pointer h-full group hover:shadow-lg hover:shadow-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-1.5">❤️ Health</span>
              <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestHealth ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Latest · {format(latestHealth.date,"EEE MMM d")}</p>
                  {latestHealth.syncedAt && (
                    <p className="text-[10px] text-muted-foreground/50">
                      Synced {Math.round((Date.now() - new Date(latestHealth.syncedAt).getTime()) / 60000)}m ago
                    </p>
                  )}
                </div>
                {latestHealth.sleepScore != null && (
                  <div className="flex items-center gap-2 rounded-lg bg-primary/8 border border-primary/15 px-3 py-1.5">
                    <Moon className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs text-muted-foreground">Sleep Score</span>
                    <span className={`ml-auto text-sm font-bold tabular-nums ${latestHealth.sleepScore >= 85 ? "text-green-400" : latestHealth.sleepScore >= 70 ? "text-amber-400" : "text-red-400"}`}>
                      {latestHealth.sleepScore}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {latestHealth.sleepDuration != null && (
                    <MetricBox icon={<Moon className="h-3.5 w-3.5 text-indigo-400"/>} label="Sleep"
                      value={`${(latestHealth.sleepDuration/60).toFixed(1)}h`}
                      sub={latestHealth.deepSleep!=null?`Deep ${latestHealth.deepSleep}m · REM ${latestHealth.remSleep??'?'}m`:undefined}
                      ok={(latestHealth.sleepDuration/60)>=SLEEP_GOAL_H} />
                  )}
                  {latestHealth.steps != null && (
                    <MetricBox icon={<Footprints className="h-3.5 w-3.5 text-green-400"/>} label="Steps"
                      value={latestHealth.steps.toLocaleString()} sub={`goal ${STEP_GOAL.toLocaleString()}`}
                      ok={latestHealth.steps>=STEP_GOAL} />
                  )}
                  {latestHealth.restingHR != null && (
                    <MetricBox icon={<Heart className="h-3.5 w-3.5 text-red-400"/>} label="Resting HR"
                      value={`${latestHealth.restingHR} bpm`} />
                  )}
                  {latestHealth.readinessScore != null && (
                    <MetricBox icon={<Shield className="h-3.5 w-3.5 text-emerald-400"/>} label="Readiness"
                      value={String(latestHealth.readinessScore)} ok={latestHealth.readinessScore>=70} />
                  )}
                  {latestHealth.hrv != null && (
                    <MetricBox icon={<Activity className="h-3.5 w-3.5 text-violet-400"/>} label="HRV"
                      value={`${Math.round(latestHealth.hrv)} ms`} />
                  )}
                  {latestHealth.spo2 != null && (
                    <MetricBox icon={<Wind className="h-3.5 w-3.5 text-cyan-400"/>} label="SpO₂"
                      value={`${(latestHealth.spo2 as number).toFixed(1)}%`} ok={(latestHealth.spo2 as number)>=95} />
                  )}
                </div>
                {sleepLogs.length > 1 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Sleep · 7 days</p>
                    <div className="flex items-end gap-0.5 h-8">
                      {[...healthLogs].reverse().map(l => {
                        const hrs = l.sleepDuration!=null ? l.sleepDuration/60 : 0
                        return (
                          <div key={l.id}
                            className={`flex-1 rounded-sm ${hrs>=7?"bg-primary":"bg-primary/35"}`}
                            style={{height:`${Math.max(10,Math.min(100,(hrs/10)*100))}%`}}
                            title={`${format(l.date,"MMM d")}: ${hrs.toFixed(1)}h`}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
                {sleepAvg!=null && (
                  <p className="text-xs text-muted-foreground">
                    7-day avg: {(sleepAvg/60).toFixed(1)}h sleep{stepsAvg!=null?` · ${Math.round(stepsAvg).toLocaleString()} steps`:""}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No health data yet</p>
            )}
          </CardContent>
        </Card>
      </Link>
    ),

    finances: (
      <Link href="/dashboard/finances" className="block h-full">
        <Card className="card-finances hover:border-emerald-500/40 transition-all cursor-pointer h-full group hover:shadow-lg hover:shadow-emerald-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-1.5">💰 Finances</span>
              <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Spent this month</p>
                <p className="text-2xl font-black text-red-400">€{(totalSpent/100).toFixed(2)}</p>
              </div>
              {totalIncome>0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Income</p>
                  <p className="text-sm font-bold text-green-400">€{(totalIncome/100).toFixed(2)}</p>
                </div>
              )}
            </div>
            {totalIncome>0 && (
              <div className="flex items-center gap-1.5 bg-secondary/50 rounded-lg px-2.5 py-1.5">
                {net>=0 ? <TrendingUp className="h-3.5 w-3.5 text-green-400 shrink-0"/> : <TrendingDown className="h-3.5 w-3.5 text-red-400 shrink-0"/>}
                <span className={`text-sm font-semibold ${net>=0?"text-green-400":"text-red-400"}`}>
                  Net: {net>=0?"+":""}€{(net/100).toFixed(2)}
                </span>
              </div>
            )}
            {topCategories.length>0 && (
              <div className="space-y-1.5">
                {topCategories.map(([cat,amt]) => (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-muted-foreground truncate max-w-[60%]">{cat}</span>
                      <span className="font-medium">€{(amt/100).toFixed(2)}</span>
                    </div>
                    <Progress value={(amt/maxCat)*100} className="h-1" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Link>
    ),

    calendar: (
      <Link href="/dashboard/calendar" className="block h-full">
        <Card className="card-calendar hover:border-blue-500/40 transition-all cursor-pointer h-full group hover:shadow-lg hover:shadow-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-1.5">🗓️ {format(now,"MMMM yyyy")}</span>
              <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <MiniMonthCalendar year={now.getFullYear()} month={now.getMonth()} todayDate={now.getDate()} eventDays={eventDays} />
              <div className="flex-1 min-w-0 border-l pl-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{format(now,"MMM d").toUpperCase()}</p>
                {todayEvents.length===0 ? (
                  <div><p className="text-sm font-medium">No events</p><p className="text-xs text-muted-foreground mt-0.5">Enjoy your day!</p></div>
                ) : (
                  <div className="space-y-2">
                    {todayEvents.map(e => (
                      <div key={e.id} className="flex gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium leading-tight">{e.title}</p>
                          {e.start&&!e.isAllDay && <p className="text-[10px] text-muted-foreground">{format(parseISO(e.start),"h:mm a")}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {nextEvents.length>0 && (
                  <div className="mt-2 pt-2 border-t space-y-1.5">
                    {nextEvents.slice(0,3).map(e => {
                      const d=parseEDay(e)
                      return (
                        <div key={e.id} className="flex gap-1.5">
                          <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground leading-tight truncate">{e.title}</p>
                            <p className="text-[10px] text-muted-foreground/60">{d?(isTomorrow(d)?"Tomorrow":format(d,"EEE MMM d")):""}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    ),

    habits: (
      <QuickHabits habits={habitsWithStreaks.slice(0, 6).map(h => ({ id: h.id, name: h.name, color: h.color, completedToday: h.completedToday, streak: h.streak }))} />
    ),

    reminders: (
      <Link href="/dashboard/reminders" className="block h-full">
        <Card className={`card-reminders hover:border-primary/40 transition-all cursor-pointer h-full group hover:shadow-lg hover:shadow-primary/5 ${overdueReminders.length>0?"border-red-500/30":""}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-1.5">🔔 Reminders</span>
              <div className="flex items-center gap-1">
                {overdueReminders.length>0 && <Badge variant="destructive" className="text-xs py-0 px-1.5">{overdueReminders.length} overdue</Badge>}
                <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reminders.length===0 ? (
              <div className="flex items-center gap-2 text-green-400"><span className="text-lg">✓</span><p className="text-sm font-medium">All clear!</p></div>
            ) : (
              <div className="space-y-1.5">
                {overdueReminders.slice(0,2).map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                    <span className="text-sm text-red-300 truncate flex-1">{r.title}</span>
                    <span className="text-xs text-red-400/70 shrink-0">overdue</span>
                  </div>
                ))}
                {dueToday.slice(0,2).map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="text-sm truncate flex-1">{r.title}</span>
                  </div>
                ))}
                {upcomingR.slice(0,3).map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                    <span className="text-sm truncate flex-1 text-muted-foreground">{r.title}</span>
                    {r.dueDate&&<span className="text-xs text-muted-foreground shrink-0">{format(r.dueDate,"MMM d")}</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Link>
    ),

    gmail: (
      <Link href="/dashboard/gmail" className="block h-full">
        <Card className="card-gmail hover:border-rose-500/40 transition-all cursor-pointer h-full group hover:shadow-lg hover:shadow-rose-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-1.5">📬 Gmail</span>
              <div className="flex items-center gap-1">
                {gmailData.unreadCount > 0 && <Badge className="text-xs bg-rose-500 hover:bg-rose-500">{gmailData.unreadCount} unread</Badge>}
                <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {gmailData.error ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Gmail access needs to be re-granted.</p>
                <ReconnectGoogleButton label="Reconnect Google" className="text-xs h-7 gap-1.5" />
              </div>
            ) : gmailData.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inbox empty</p>
            ) : (
              <div className="space-y-2">
                {gmailData.messages.slice(0, 5).map(m => (
                  <div key={m.id} className="flex items-start gap-2 min-w-0">
                    <div className={`h-1.5 w-1.5 rounded-full shrink-0 mt-1.5 ${m.isUnread ? "bg-rose-400" : "bg-muted-foreground/40"}`} />
                    <div className="min-w-0">
                      <p className={`text-xs leading-tight truncate ${m.isUnread ? "font-semibold" : "text-muted-foreground"}`}>{m.subject}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{m.fromName}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Link>
    ),

    quicklog: (
      <QuickLog todayWaterMl={waterMl} todayFocusMin={focusMinToday} todayMood={todayMood} latestWeight={latestHealth?.weight ?? null} />
    ),

    stats: (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 h-full content-start">
        <Link href="/dashboard/intake">
          <StatTile label="Water today" value={waterMl >= 1000 ? `${(waterMl/1000).toFixed(1)}L` : `${waterMl}ml`}
            sub={waterMl >= 2000 ? "Goal reached ✓" : `${Math.max(0, 2000-waterMl)}ml to go`}
            icon={<Droplets className="h-4 w-4 text-blue-400"/>} ok={waterMl >= 2000}
            progress={Math.min(100, (waterMl/2000)*100)} />
        </Link>
        <Link href="/dashboard/intake">
          <StatTile label="Coffee today" value={coffeeMl >= 1000 ? `${(coffeeMl/1000).toFixed(1)}L` : `${coffeeMl}ml`}
            sub={coffeeMl >= 400 ? "Over limit ⚠" : coffeeMl > 0 ? `${400-coffeeMl}ml to limit` : "none yet"}
            icon={<span className="text-base leading-none">☕</span>} ok={coffeeMl > 0 && coffeeMl <= 400} />
        </Link>
        <Link href="/dashboard/focus">
          <StatTile label="Focus today" value={focusMinToday >= 60 ? `${(focusMinToday/60).toFixed(1)}h` : `${focusMinToday}m`}
            sub="deep work" icon={<Timer className="h-4 w-4 text-primary"/>} />
        </Link>
        <Link href="/dashboard/habits">
          <StatTile label="Habits today" value={`${doneToday}/${habits.length}`} icon={<CheckSquare className="h-4 w-4 text-amber-400"/>}
            progress={habits.length > 0 ? (doneToday/habits.length)*100 : 0} />
        </Link>
        <StatTile label="Spent this month" value={`€${(totalSpent/100).toFixed(0)}`} icon={<Flame className="h-4 w-4 text-emerald-400"/>} />
        {todayMedTags.length > 0 ? (
          <Link href="/dashboard/medications">
            <StatTile label="Taken today" value={`${todayMedTags.length}`}
              sub={todayMedTags.slice(0, 2).join(", ") + (todayMedTags.length > 2 ? ` +${todayMedTags.length - 2}` : "")}
              icon={<span className="text-base leading-none">💊</span>} ok />
          </Link>
        ) : null}
      </div>
    ),

    location: <LocationCard />,
    ac: <AcCard />,
    quests: <DailyQuests />,
  }

  return <DashboardGrid header={header} blocks={blocks} />
}

function MetricBox({ icon, label, value, sub, ok }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; ok?: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">{icon}{label}</div>
      <span className={`text-sm font-bold ${ok===true?"text-green-400":ok===false?"text-amber-400":""}`}>{value}</span>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function StatTile({ label, value, sub, icon, ok, progress }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; ok?: boolean; progress?: number
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-all cursor-pointer hover:border-primary/30 hover:shadow-sm bg-gradient-to-br from-primary/5 to-card ${ok === true ? "border-green-500/30" : ""}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground tracking-wide">{label}</p>
        <p className={`text-lg font-bold tabular-nums ${ok === true ? "text-green-400" : ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        {progress !== undefined && (
          <div className="mt-1.5 h-1 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: ok ? "linear-gradient(90deg, #22c55e, #4ade80)" : "linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary) 70%, #fff))",
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
