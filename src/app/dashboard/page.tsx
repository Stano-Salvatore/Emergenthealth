import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUpcomingEvents } from "@/lib/google-calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import Link from "next/link"
import {
  Activity,
  Euro,
  Calendar,
  CheckSquare,
  Bell,
  Moon,
  Footprints,
  ChevronRight,
  Heart,
  Scale,
  Clock,
  TrendingUp,
  TrendingDown,
  Zap,
} from "lucide-react"
import { format, isToday, isTomorrow, parseISO, isBefore } from "date-fns"
import { LiveClock } from "@/components/dashboard/LiveClock"
import { WeatherWidget } from "@/components/dashboard/WeatherWidget"

const STEP_GOAL = 8_000

function getTimeGreeting() {
  const h = new Date().getHours()
  if (h < 12) return "morning"
  if (h < 18) return "afternoon"
  return "evening"
}

export default async function DashboardPage() {
  const session = await auth()
  const userId = session!.user.id
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const todayStr = today.toISOString().split("T")[0]
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [healthLogs, habits, reminders, transactions, calendarEvents] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 7,
    }),
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      include: {
        completions: {
          where: { date: { gte: weekAgo } },
          orderBy: { date: "desc" },
        },
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
  ])

  // ── health ──
  const latestHealth = healthLogs[0] ?? null
  const sleepAvg =
    healthLogs.filter(l => l.sleepDuration != null).length > 0
      ? healthLogs.reduce((s, l) => s + (l.sleepDuration ?? 0), 0) /
        healthLogs.filter(l => l.sleepDuration != null).length
      : null
  const stepsAvg =
    healthLogs.filter(l => l.steps != null).length > 0
      ? healthLogs.reduce((s, l) => s + (l.steps ?? 0), 0) /
        healthLogs.filter(l => l.steps != null).length
      : null

  // ── finances ──
  const spending = transactions.filter(t => t.amount < 0)
  const income = transactions.filter(t => t.amount > 0)
  const totalSpent = spending.reduce((s, t) => s + Math.abs(t.amount), 0)
  const totalIncome = income.reduce((s, t) => s + t.amount, 0)
  const net = totalIncome - totalSpent

  const byCategory = spending.reduce((acc, t) => {
    const c = t.category ?? "Uncategorized"
    acc[c] = (acc[c] ?? 0) + Math.abs(t.amount)
    return acc
  }, {} as Record<string, number>)
  const topCategories = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
  const maxCatSpend = topCategories[0]?.[1] ?? 1

  // ── habits ──
  const habitsWithStreaks = habits.map(h => {
    const dates = new Set(h.completions.map(c => c.date.toISOString().split("T")[0]))
    let streak = 0
    const cursor = new Date(today)
    while (dates.has(cursor.toISOString().split("T")[0])) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    }
    return { ...h, streak, completedToday: dates.has(todayStr) }
  })
  const doneToday = habitsWithStreaks.filter(h => h.completedToday).length

  // ── reminders ──
  const overdueReminders = reminders.filter(r => r.dueDate && isBefore(r.dueDate, new Date()))
  const dueToday = reminders.filter(r => r.dueDate && isToday(r.dueDate))
  const upcoming = reminders.filter(r => !r.dueDate || (!isBefore(r.dueDate, new Date()) && !isToday(r.dueDate)))

  // ── calendar: today's events ──
  const todayEvents = calendarEvents.filter(e => {
    if (!e.start) return false
    try {
      const d = e.isAllDay ? new Date(e.start + "T00:00:00") : parseISO(e.start)
      return isToday(d)
    } catch { return false }
  })
  const nextEvents = calendarEvents.filter(e => {
    if (!e.start) return false
    try {
      const d = e.isAllDay ? new Date(e.start + "T00:00:00") : parseISO(e.start)
      return !isToday(d)
    } catch { return false }
  }).slice(0, 4)

  return (
    <div className="space-y-6">
      {/* ── greeting ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            Good {getTimeGreeting()}, {session!.user.name?.split(" ")[0] ?? "there"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
          <div className="mt-1">
            <LiveClock />
          </div>
        </div>
        <WeatherWidget />
      </div>

      {/* ── today's events strip (if any) ── */}
      {todayEvents.length > 0 && (
        <div className="rounded-xl border bg-primary/5 border-primary/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">Today&apos;s Schedule</span>
            <Badge variant="secondary" className="text-xs">{todayEvents.length} event{todayEvents.length > 1 ? "s" : ""}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {todayEvents.map(e => (
              <div key={e.id} className="flex items-center gap-2 bg-background/60 rounded-lg px-3 py-1.5 border">
                <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                <span className="text-sm font-medium">{e.title}</span>
                {e.start && !e.isAllDay && (
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(e.start), "h:mm a")}
                  </span>
                )}
                {e.isAllDay && <span className="text-xs text-muted-foreground">all day</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── main grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">

        {/* ── health ── */}
        <Link href="/dashboard/health">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Activity className="h-4 w-4" /> Health</span>
                <ChevronRight className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestHealth ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Latest · {format(latestHealth.date, "EEE MMM d")}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {latestHealth.sleepDuration != null && (
                      <StatRow icon={<Moon className="h-3.5 w-3.5 text-indigo-400" />}
                        label="Sleep"
                        value={`${(latestHealth.sleepDuration / 60).toFixed(1)}h`}
                        sub={latestHealth.deepSleep != null ? `Deep ${latestHealth.deepSleep}m · REM ${latestHealth.remSleep ?? "?"}m` : undefined}
                      />
                    )}
                    {latestHealth.steps != null && (
                      <StatRow icon={<Footprints className="h-3.5 w-3.5 text-green-400" />}
                        label="Steps"
                        value={latestHealth.steps.toLocaleString()}
                        sub={`goal ${STEP_GOAL.toLocaleString()}`}
                        highlight={latestHealth.steps >= STEP_GOAL}
                      />
                    )}
                    {latestHealth.restingHR != null && (
                      <StatRow icon={<Heart className="h-3.5 w-3.5 text-red-400" />}
                        label="Resting HR"
                        value={`${latestHealth.restingHR} bpm`}
                      />
                    )}
                    {(latestHealth as any).weight != null && (
                      <StatRow icon={<Scale className="h-3.5 w-3.5 text-blue-400" />}
                        label="Weight"
                        value={`${(latestHealth as any).weight} kg`}
                      />
                    )}
                  </div>
                  {healthLogs.filter(l => l.sleepDuration != null).length > 1 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Sleep · 7 days</p>
                      <div className="flex items-end gap-0.5 h-8">
                        {[...healthLogs].reverse().map(l => {
                          const hrs = l.sleepDuration != null ? l.sleepDuration / 60 : 0
                          const pct = Math.min(100, (hrs / 10) * 100)
                          const good = hrs >= 7
                          return (
                            <div
                              key={l.id}
                              className={`flex-1 rounded-sm ${good ? "bg-indigo-500" : "bg-indigo-500/40"}`}
                              style={{ height: `${Math.max(10, pct)}%` }}
                              title={`${format(l.date, "MMM d")}: ${hrs.toFixed(1)}h`}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {sleepAvg != null && (
                    <p className="text-xs text-muted-foreground">
                      7-day avg: {(sleepAvg / 60).toFixed(1)}h sleep
                      {stepsAvg != null ? ` · ${Math.round(stepsAvg).toLocaleString()} steps` : ""}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No health data yet</p>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* ── finances ── */}
        <Link href="/dashboard/finances">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Euro className="h-4 w-4" /> Finances</span>
                <ChevronRight className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Spent this month</p>
                  <p className="text-xl font-bold text-red-400">€{(totalSpent / 100).toFixed(2)}</p>
                </div>
                {totalIncome > 0 && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Income</p>
                    <p className="text-sm font-semibold text-green-400">€{(totalIncome / 100).toFixed(2)}</p>
                  </div>
                )}
              </div>
              {totalIncome > 0 && (
                <div className="flex items-center gap-1.5">
                  {net >= 0
                    ? <TrendingUp className="h-3.5 w-3.5 text-green-400 shrink-0" />
                    : <TrendingDown className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                  <span className={`text-sm font-medium ${net >= 0 ? "text-green-400" : "text-red-400"}`}>
                    Net: {net >= 0 ? "+" : ""}€{(net / 100).toFixed(2)}
                  </span>
                </div>
              )}
              {topCategories.length > 0 && (
                <div className="space-y-1.5">
                  {topCategories.map(([cat, amt]) => (
                    <div key={cat}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground truncate max-w-[60%]">{cat}</span>
                        <span className="font-medium">€{(amt / 100).toFixed(2)}</span>
                      </div>
                      <Progress value={(amt / maxCatSpend) * 100} className="h-1" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* ── calendar ── */}
        <Link href="/dashboard/calendar">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> Upcoming</span>
                <ChevronRight className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {calendarEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming events</p>
              ) : (
                <div className="space-y-2">
                  {nextEvents.map(e => {
                    const d = e.isAllDay
                      ? new Date(e.start! + "T00:00:00")
                      : parseISO(e.start!)
                    const dayLabel = isToday(d) ? "Today" : isTomorrow(d) ? "Tomorrow" : format(d, "EEE MMM d")
                    return (
                      <div key={e.id} className="flex items-start gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{e.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {dayLabel}
                            {!e.isAllDay && e.start ? ` · ${format(parseISO(e.start), "h:mm a")}` : ""}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                  {calendarEvents.length > nextEvents.length + todayEvents.length && (
                    <p className="text-xs text-muted-foreground pt-0.5">
                      +{calendarEvents.length - nextEvents.length - todayEvents.length} more events
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* ── habits ── */}
        <Link href="/dashboard/habits">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5"><CheckSquare className="h-4 w-4" /> Habits</span>
                <span className="text-xs font-normal tabular-nums">
                  {doneToday}/{habits.length} today
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {habits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No habits set up</p>
              ) : (
                <div className="space-y-2">
                  {habitsWithStreaks.slice(0, 6).map(h => (
                    <div key={h.id} className="flex items-center gap-2">
                      <div
                        className={`h-2.5 w-2.5 rounded-full shrink-0 transition-opacity ${h.completedToday ? "opacity-100" : "opacity-25"}`}
                        style={{ backgroundColor: h.color }}
                      />
                      <span className={`text-sm flex-1 truncate ${h.completedToday ? "" : "text-muted-foreground"}`}>
                        {h.name}
                      </span>
                      {h.streak > 0 && (
                        <span className="text-xs text-orange-400 font-medium tabular-nums shrink-0">
                          {h.streak}🔥
                        </span>
                      )}
                    </div>
                  ))}
                  {habits.length > 6 && (
                    <p className="text-xs text-muted-foreground">+{habits.length - 6} more</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* ── reminders ── */}
        <Link href="/dashboard/reminders">
          <Card className={`hover:border-primary/40 transition-colors cursor-pointer h-full ${overdueReminders.length > 0 ? "border-red-500/30" : ""}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Bell className="h-4 w-4" /> Reminders</span>
                <div className="flex items-center gap-1">
                  {overdueReminders.length > 0 && (
                    <Badge variant="destructive" className="text-xs py-0 px-1.5">{overdueReminders.length} overdue</Badge>
                  )}
                  <ChevronRight className="h-4 w-4" />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reminders.length === 0 ? (
                <p className="text-sm text-muted-foreground">All clear!</p>
              ) : (
                <div className="space-y-1.5">
                  {overdueReminders.slice(0, 2).map(r => (
                    <div key={r.id} className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                      <span className="text-sm text-red-300 truncate flex-1">{r.title}</span>
                      <span className="text-xs text-red-400/70 shrink-0">overdue</span>
                    </div>
                  ))}
                  {dueToday.slice(0, 2).map(r => (
                    <div key={r.id} className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-sm truncate flex-1">{r.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">today</span>
                    </div>
                  ))}
                  {upcoming.slice(0, 3).map(r => (
                    <div key={r.id} className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                      <span className="text-sm truncate flex-1 text-muted-foreground">{r.title}</span>
                      {r.dueDate && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {format(r.dueDate, "MMM d")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* ── at a glance ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-yellow-400" /> At a Glance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {habitsWithStreaks.filter(h => h.streak > 1).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Top streaks</p>
                {habitsWithStreaks
                  .filter(h => h.streak > 1)
                  .sort((a, b) => b.streak - a.streak)
                  .slice(0, 3)
                  .map(h => (
                    <div key={h.id} className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: h.color }} />
                        <span className="text-sm">{h.name}</span>
                      </div>
                      <span className="text-sm font-bold text-orange-400">{h.streak}🔥</span>
                    </div>
                  ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <StatTile label="Events (14d)" value={String(calendarEvents.length)} />
              <StatTile label="Reminders" value={String(reminders.length)} />
              <StatTile label="Habits today" value={`${doneToday}/${habits.length}`} />
              <StatTile label="Transactions" value={String(spending.length)} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatRow({
  icon, label, value, sub, highlight,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
        {icon} {label}
      </div>
      <span className={`text-sm font-semibold ${highlight ? "text-green-400" : ""}`}>{value}</span>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 px-3 py-2 text-center">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold mt-0.5">{value}</p>
    </div>
  )
}
