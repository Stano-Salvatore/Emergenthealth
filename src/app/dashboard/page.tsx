import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUpcomingEvents } from "@/lib/google-calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import {
  Activity,
  DollarSign,
  Calendar,
  CheckSquare,
  Bell,
  Moon,
  Footprints,
  Flame,
  ChevronRight,
} from "lucide-react"
import { format } from "date-fns"
import { LiveClock } from "@/components/dashboard/LiveClock"
import { WeatherWidget } from "@/components/dashboard/WeatherWidget"

export default async function DashboardPage() {
  const session = await auth()
  const userId = session!.user.id
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const todayStr = today.toISOString().split("T")[0]

  const [latestHealth, habits, reminders, transactions, calendarEvents] = await Promise.all([
    prisma.healthLog.findFirst({
      where: { userId },
      orderBy: { date: "desc" },
    }),
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      include: {
        completions: {
          where: { date: { gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) } },
          orderBy: { date: "desc" },
        },
      },
    }),
    prisma.reminder.findMany({
      where: { userId, isCompleted: false },
      orderBy: [{ dueDate: "asc" }],
      take: 5,
    }),
    prisma.transaction.findMany({
      where: { userId, date: { gte: monthStart }, amount: { lt: 0 }, isTransfer: false },
    }),
    getUpcomingEvents(userId, 7),
  ])

  const totalSpent = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
  const completedHabits = habits.filter((h) =>
    h.completions.some((c) => c.date.toISOString().split("T")[0] === todayStr)
  ).length

  const habitsWithStreaks = habits.map((h) => {
    const completionDates = new Set(h.completions.map((c) => c.date.toISOString().split("T")[0]))
    let streak = 0
    const cursor = new Date(today)
    while (completionDates.has(cursor.toISOString().split("T")[0])) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    }
    return { ...h, streak, completedToday: completionDates.has(todayStr) }
  })

  const overdueReminders = reminders.filter(
    (r) => r.dueDate && new Date(r.dueDate) < new Date()
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            Good {getTimeGreeting()}, {session!.user.name?.split(" ")[0] ?? "there"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {format(new Date(), "EEEE, MMMM d")}
          </p>
          <div className="mt-1">
            <LiveClock />
          </div>
        </div>
        <WeatherWidget />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Health */}
        <Link href="/dashboard/health">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4" /> Health
                </span>
                <ChevronRight className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latestHealth ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {format(latestHealth.date, "MMM d")}
                  </p>
                  <div className="flex items-center gap-4">
                    {latestHealth.sleepDuration != null && (
                      <div className="flex items-center gap-1.5">
                        <Moon className="h-4 w-4 text-indigo-400" />
                        <span className="font-semibold">
                          {(latestHealth.sleepDuration / 60).toFixed(1)}h
                        </span>
                      </div>
                    )}
                    {latestHealth.steps != null && (
                      <div className="flex items-center gap-1.5">
                        <Footprints className="h-4 w-4 text-green-400" />
                        <span className="font-semibold">
                          {latestHealth.steps.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                  {latestHealth.deepSleep != null && (
                    <p className="text-xs text-muted-foreground">
                      Deep {latestHealth.deepSleep}min · REM {latestHealth.remSleep ?? "?"}min
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet — log your first day</p>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Finances */}
        <Link href="/dashboard/finances">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4" /> Finances
                </span>
                <ChevronRight className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Spent this month</p>
                <p className="text-2xl font-bold text-red-400">
                  €{(totalSpent / 100).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {transactions.length} transactions
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Calendar */}
        <Link href="/dashboard/calendar">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" /> Calendar
                </span>
                <ChevronRight className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {calendarEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming events</p>
              ) : (
                <div className="space-y-1.5">
                  {calendarEvents.slice(0, 3).map((e) => (
                    <div key={e.id} className="flex items-start gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.start
                            ? new Date(e.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                            : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                  {calendarEvents.length > 3 && (
                    <p className="text-xs text-muted-foreground">
                      +{calendarEvents.length - 3} more
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Habits */}
        <Link href="/dashboard/habits">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <CheckSquare className="h-4 w-4" /> Habits
                </span>
                <ChevronRight className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {habits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No habits set up</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-2xl font-bold">
                    {completedHabits}
                    <span className="text-muted-foreground text-base font-normal">
                      /{habits.length}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">done today</p>
                  <div className="flex gap-1 mt-2">
                    {habitsWithStreaks.slice(0, 5).map((h) => (
                      <div
                        key={h.id}
                        className={`h-2 flex-1 rounded-full ${h.completedToday ? "" : "opacity-30"}`}
                        style={{ backgroundColor: h.color }}
                        title={h.name}
                      />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Reminders */}
        <Link href="/dashboard/reminders">
          <Card
            className={`hover:border-primary/40 transition-colors cursor-pointer h-full ${
              overdueReminders.length > 0 ? "border-red-500/30" : ""
            }`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Bell className="h-4 w-4" /> Reminders
                </span>
                <div className="flex items-center gap-1">
                  {overdueReminders.length > 0 && (
                    <Badge variant="destructive" className="text-xs py-0 px-1.5">
                      {overdueReminders.length}
                    </Badge>
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
                  {reminders.slice(0, 3).map((r) => (
                    <div key={r.id} className="flex items-start gap-2">
                      <div
                        className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${
                          r.dueDate && new Date(r.dueDate) < new Date()
                            ? "bg-red-400"
                            : "bg-muted-foreground"
                        }`}
                      />
                      <p className="text-sm truncate">{r.title}</p>
                    </div>
                  ))}
                  {reminders.length > 3 && (
                    <p className="text-xs text-muted-foreground">+{reminders.length - 3} more</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Streaks */}
        {habitsWithStreaks.some((h) => h.streak > 0) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-orange-400" /> Top Streaks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {habitsWithStreaks
                  .filter((h) => h.streak > 0)
                  .sort((a, b) => b.streak - a.streak)
                  .slice(0, 3)
                  .map((h) => (
                    <div key={h.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: h.color }}
                        />
                        <span className="text-sm">{h.name}</span>
                      </div>
                      <span className="text-sm font-bold text-orange-400">{h.streak}🔥</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function getTimeGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return "morning"
  if (hour < 18) return "afternoon"
  return "evening"
}
