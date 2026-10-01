// Past periods, newest first: when each started, how long it lasted, and how
// long the cycle it began turned out to be.

import { daysBetween, type Period } from "@/lib/cycle"
import { shortDay } from "@/lib/cycle-text"

export function PeriodHistory({ periods, between }: { periods: Period[]; between: string[] }) {
  if (periods.length === 0) return <p className="text-sm text-muted-foreground">No periods logged yet.</p>
  const rows = periods.map((p, i) => ({ ...p, cycle: periods[i + 1] ? daysBetween(p.start, periods[i + 1].start) : null })).reverse()
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border/60">
        {rows.slice(0, 12).map(r => (
          <li key={r.start} className="flex items-center justify-between py-1.5 text-sm">
            <span>{shortDay(r.start)} <span className="text-muted-foreground text-xs">{r.start.slice(0, 4)}</span></span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {r.days} day{r.days === 1 ? "" : "s"}
              {r.cycle != null && (r.cycle > 60 ? " · gap in logging" : ` · cycle ${r.cycle} days`)}
            </span>
          </li>
        ))}
      </ul>
      {between.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Bleeding between periods logged on {between.slice(-5).map(shortDay).join(", ")}. Bleeding between periods is worth mentioning to a doctor if it keeps happening.
        </p>
      )}
    </div>
  )
}
