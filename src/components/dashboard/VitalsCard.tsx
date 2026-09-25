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
// instead of five stale rows dressed as tonight's.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { scanUserAnomalies } from "@/lib/anomaly-scan"

export async function VitalsCard({ userId }: { userId: string }) {
  let scan
  try {
    scan = await scanUserAnomalies(userId)
  } catch {
    return null
  }

  if (scan.stale) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Last night&apos;s vitals</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            The ring has been quiet since {scan.latestDate ?? "a while ago"} — nothing recent enough to call &quot;last night&quot;.
          </p>
        </CardContent>
      </Card>
    )
  }
  if (scan.vitals.length === 0) return null

  const flaggedCount = scan.vitals.filter(v => v.flagged).length

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-baseline justify-between">
          <span>Last night&apos;s vitals</span>
          <span className="text-xs font-normal text-muted-foreground">
            {flaggedCount === 0 ? "all in your usual band" : `${flaggedCount} outside the usual band`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
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
                    <span className="font-semibold">{v.value}{v.unit}</span>
                    <span className="text-muted-foreground text-xs"> · usual {v.baseline}{v.unit}</span>
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
