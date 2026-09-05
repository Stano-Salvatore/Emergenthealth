import { Card, CardContent } from "@/components/ui/card"
import { loadStatusOverview } from "@/lib/status-overview"
import { dayLabel, type StatusRow, type StatusTone } from "@/lib/status-rows"
import { DeviceStatusChips } from "@/components/settings/DeviceStatusChips"
import { SyncNowButton } from "@/components/settings/SyncNowButton"

const DOT: Record<StatusTone, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-red-400",
  off: "bg-muted-foreground/40",
}
const TEXT: Record<StatusTone, string> = {
  ok: "text-foreground",
  warn: "text-amber-400",
  bad: "text-red-400",
  off: "text-muted-foreground",
}

export function StatusLine({ row }: { row: StatusRow }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 rounded-full shrink-0 ${DOT[row.tone]}`} aria-hidden />
        <span className="text-sm leading-snug truncate">{row.label}</span>
      </div>
      <div className="text-right shrink-0 max-w-[55%]">
        <p className={`text-xs leading-snug ${TEXT[row.tone]}`}>{row.value}</p>
        {row.detail && <p className="text-[10px] text-muted-foreground leading-snug truncate">{row.detail}</p>}
      </div>
    </div>
  )
}

/**
 * Everything the app is connected to, and when it last worked — one glance,
 * before the twenty-five cards below. Server-known things come from the
 * database; the things only the phone knows (permissions, whether the chat
 * head is up, background location) are added by the device chips, which
 * render nothing on the web.
 *
 * This is also where sync status lives now. There used to be a second card
 * further down repeating the same sources with the same times, which meant two
 * places to look and two chances for them to disagree. Everything that card
 * offered on its own — the button, what a run actually brought back, and the
 * freshest day held — is here instead.
 */
export async function StatusOverview({ userId }: { userId: string }) {
  const { rows, today, cadenceMinutes, newestHealthDate, serverSources } = await loadStatusOverview(userId)
  const groups: StatusRow["group"][] = ["Data", "Notifications", "Emergy"]
  const attention = rows.filter(r => r.tone === "bad" || r.tone === "warn").length

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">At a glance</p>
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] text-muted-foreground">
              {attention === 0 ? "Everything connected is working." : `${attention} thing${attention === 1 ? "" : "s"} worth a look.`}
            </p>
            {serverSources.length > 0 && <SyncNowButton sources={serverSources} />}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {groups.map(g => (
            <div key={g} className="pt-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 pt-1">{g}</p>
              {rows.filter(r => r.group === g).map(r => <StatusLine key={r.id} row={r} />)}
            </div>
          ))}
          <DeviceStatusChips />
        </div>
        {/* The times above are when a run last FINISHED, not when it was due —
            GitHub schedules the server ones and can delay them. Phone sources
            sync when you open the app and only record their successes. */}
        <p className="text-[11px] text-muted-foreground/70 pt-1 leading-snug">
          Server syncs run every {cadenceMinutes} minutes; phone syncs run when you open the app.
          {newestHealthDate && (
            <> Freshest health day held: <span className="text-foreground/80">{dayLabel(newestHealthDate, today)}</span>
            {" — a second opinion, in case a sync reports success and brings back nothing."}</>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
