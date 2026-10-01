// Last night's vitals against your own baselines — outliers or not.
//
// The anomaly scanner has computed these deviations since 3.2 and spoke only
// when something spiked. Samsung's Vitals screen showed why that is half a
// feature: "all five inside your usual band" is a finding, and on the days
// something DID move the user should not have to wait for the brief to
// mention it. Server component, one scan, no client fetch.
//
// The bands are the user's own 45-day median with a robust spread — never
// clinical ranges, and the footer says so. A signal the ring did not report
// last night shows a dash, not a zero. A stale ring gets one honest line
// instead of five stale rows dressed as tonight's. Above the rows, the night
// graded as a whole (body-strain.ts): seven signals, not just these five.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { scanUserAnomalies } from "@/lib/anomaly-scan"
import { userToday } from "@/lib/user-timezone"
import { vitalText } from "@/lib/vital-format"

const STRAIN_TONE = {
  none: "border-emerald-500/30 bg-emerald-500/5",
  minor: "border-amber-500/40 bg-amber-500/5",
  major: "border-rose-500/50 bg-rose-500/10",
} as const

export async function VitalsCard({ userId }: { userId: string }) {
  let scan
  try {
    scan = await scanUserAnomalies(userId)
  } catch {
    return null
  }

  if (scan.stale || scan.vitalsStale) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Last night&apos;s vitals</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            The ring has been quiet since {(scan.vitalsStale ? scan.vitalsDate : scan.latestDate) ?? "a while ago"} — nothing recent enough to call &quot;last night&quot;.
          </p>
        </CardContent>
      </Card>
    )
  }
  if (scan.vitals.length === 0) return null

  // Oura files a night under the day you woke, so only a night dated today is
  // "last night"; anything older is named by its date rather than passed off
  // as this morning's.
  const today = await userToday(userId).catch(() => null)
  const isLastNight = scan.vitalsDate != null && scan.vitalsDate === today
  const title = isLastNight || !scan.vitalsDate
    ? "Last night's vitals"
    : `Vitals · night to ${new Date(scan.vitalsDate + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}`

  // A dash is not a reading, and a header that counts it as "in your usual
  // band" is reassurance about something nobody measured.
  const measured = scan.vitals.filter(v => v.value != null)
  if (measured.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No overnight readings yet.</p>
        </CardContent>
      </Card>
    )
  }
  const flaggedCount = measured.filter(v => v.flagged).length
  const status = flaggedCount > 0
    ? `${flaggedCount} outside the usual band`
    : measured.length === scan.vitals.length
      ? "all in your usual band"
      : `all ${measured.length} measured in your usual band`

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-baseline justify-between">
          <span>{title}</span>
          <span className="text-xs font-normal text-muted-foreground">{status}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {scan.strain && (
          <div className={`mb-2 rounded-md border px-2.5 py-2 ${STRAIN_TONE[scan.strain.level]}`}>
            <p className="text-xs font-semibold">{scan.strain.headline}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{scan.strain.summary}</p>
          </div>
        )}
        <ul className="divide-y divide-border/60">
          {scan.vitals.map(v => (
            <li key={v.key} className="flex items-center justify-between py-1.5 text-sm">
              <span className="flex items-center gap-2">
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${v.value == null ? "bg-muted-foreground/40" : v.flagged ? "bg-amber-400" : "bg-emerald-400"}`} />
                {v.label}
              </span>
              <span className="tabular-nums">
                {v.value != null ? (
                  <>
                    <span className="font-semibold">{vitalText(v.key, v.value, v.unit)}</span>
                    <span className="text-muted-foreground text-xs"> · usual {vitalText(v.key, v.baseline, v.unit)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground mt-2">
          Bands are your own 45-day median, not clinical ranges — a flag is something to notice, never a diagnosis.
        </p>
      </CardContent>
    </Card>
  )
}
