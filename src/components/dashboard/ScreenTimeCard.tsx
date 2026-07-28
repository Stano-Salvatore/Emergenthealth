import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Smartphone } from "lucide-react"

function fmtHm(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtWake(minsAfterMidnight: number): string {
  const h = Math.floor(minsAfterMidnight / 60)
  const m = minsAfterMidnight % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function localDateStr(d = new Date()): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-")
}

export async function ScreenTimeCard() {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id

  // Most recent 14 days, oldest-first for left-to-right charting.
  const rows = (await prisma.screenTimeLog
    .findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 14,
      select: { date: true, totalMin: true, firstUnlockMin: true },
    })
    .catch(() => [])).reverse()

  // Empty state — most likely a web user with no native sync yet.
  if (rows.length === 0) {
    return (
      <div className="h-full rounded-xl border bg-card p-4 flex flex-col">
        <div className="flex items-center gap-2 text-sm font-semibold mb-2">
          <Smartphone className="h-4 w-4 text-primary" /> Screen Time
        </div>
        <p className="text-xs text-muted-foreground">
          No screen-time data yet. Open Emergenthealth on your Android phone and grant Usage access
          in Settings → Screen Time to start tracking.
        </p>
      </div>
    )
  }

  const today = localDateStr()
  const todayRow = rows.find((r) => r.date === today) ?? null
  const avg7 = rows.slice(-7).reduce((s, r) => s + r.totalMin, 0) / Math.min(7, rows.length)
  const wakeVals = rows.slice(-7).filter((r) => r.firstUnlockMin != null).map((r) => r.firstUnlockMin!)
  const avgWake = wakeVals.length ? Math.round(wakeVals.reduce((s, v) => s + v, 0) / wakeVals.length) : null
  const max = Math.max(...rows.map((r) => r.totalMin), 1)

  const headline = todayRow ? todayRow.totalMin : rows[rows.length - 1].totalMin
  const headlineLabel = todayRow ? "Today" : "Latest"

  return (
    <div className="h-full rounded-xl border bg-card p-4 flex flex-col">
      <div className="flex items-center gap-2 text-sm font-semibold mb-3">
        <Smartphone className="h-4 w-4 text-primary" /> Screen Time
      </div>

      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{headlineLabel}</p>
          <p className="text-2xl font-bold tabular-nums leading-tight">{fmtHm(headline)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">7-day avg</p>
          <p className="text-sm font-semibold tabular-nums">{fmtHm(avg7)}</p>
          {avgWake != null && (
            <p className="text-[10px] text-muted-foreground mt-0.5">wake ~{fmtWake(avgWake)}</p>
          )}
        </div>
      </div>

      {/* Daily-total bars (last 14 days) */}
      <div className="mt-auto flex items-end gap-[3px] h-14">
        {rows.map((r) => {
          const pct = Math.max(4, Math.round((r.totalMin / max) * 100))
          const isToday = r.date === today
          return (
            <div
              key={r.date}
              className={`flex-1 rounded-sm ${isToday ? "bg-primary" : "bg-primary/35"}`}
              style={{ height: `${pct}%` }}
              title={`${r.date}: ${fmtHm(r.totalMin)}`}
            />
          )
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5 text-center">last {rows.length} days</p>
    </div>
  )
}
