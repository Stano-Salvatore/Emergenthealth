"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Check, FileText, Mail, Printer, RefreshCw } from "lucide-react"
import type { HealthReport } from "@/lib/health-report"
import { printPage, printSupport } from "@/lib/native/print"

// The one thing this app produced that a doctor could not use was everything.
// JSON is for scripts, the dashboard is for browsing; fifteen minutes across a
// desk needs one page of paper. Print styles live in globals.css under
// `.report-doc` — the browser's own "Save as PDF" does the export, which keeps
// a PDF library (and its fonts) out of the bundle.
//
// "and works on Android too" is what the comment used to claim, and it was
// wrong: window.print() inside an Android WebView is a silent no-op, so the
// export button did nothing on the phone. Printing now goes through the native
// bridge (see lib/native/print), and every surface also gets "Email it to me",
// which needs no print stack at all.

const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "6 months" },
]

function fmtDay(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function Delta({ now, prev, decimals, higherIsBetter }: { now: number | null; prev: number | null; decimals: number; higherIsBetter: boolean }) {
  if (now == null || prev == null || prev === 0) return <span className="text-muted-foreground/50">—</span>
  const diff = now - prev
  const f = 10 ** decimals
  const shown = Math.round(diff * f) / f
  if (Math.abs(diff) < 1 / (f * 2)) return <span className="text-muted-foreground/60">no change</span>
  const better = higherIsBetter ? diff > 0 : diff < 0
  return (
    <span className={better ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
      {shown > 0 ? "+" : ""}{shown}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-section mt-6">
      <h2 className="text-[13px] font-bold uppercase tracking-widest text-primary print:text-black border-b border-border print:border-black/30 pb-1 mb-2">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * Tables here are six columns wide and the page is read on a phone. Bare, the
 * last column ("Days", the one that says how much data each average rests on)
 * was clipped off the right edge and unreachable — the card hides the overflow,
 * so it did not even scroll. Print is unaffected: paper is wide enough.
 */
function TableScroll({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto print:overflow-visible">{children}</div>
}

const TABLE = "w-full min-w-[34rem] print:min-w-0"

const TH = "text-left font-semibold text-[11px] uppercase tracking-wide text-muted-foreground print:text-black/60 py-1 pr-3"
const TD = "py-1 pr-3 align-top"

export default function ReportPage() {
  const [days, setDays] = useState(90)
  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  // Whether this surface has a print stack at all. An Android shell older than
  // the native print bridge answers "none" — hiding the button there beats
  // offering one that does nothing, which is the bug this replaced.
  //
  // Read through useSyncExternalStore rather than an effect: the answer is a
  // property of the browser, never changes, and the server has to say "no"
  // so the markup it renders matches the client's first paint.
  const canPrint = useSyncExternalStore(
    () => () => {},
    () => printSupport() !== "none",
    () => false,
  )

  async function emailReport() {
    setSending(true)
    setSent(null)
    try {
      const res = await fetch("/api/report/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      })
      const d = await res.json().catch(() => null)
      setSent(res.ok ? "sent" : (d?.error ?? "Couldn't send the report."))
      if (res.ok) setTimeout(() => setSent(null), 6000)
    } catch {
      setSent("Couldn't send the report — check your connection.")
    }
    setSending(false)
  }

  // The fetch lives inside the effect so every state update happens after an
  // await, and `cancelled` drops a stale response when the period is switched
  // faster than the API answers. The spinner is turned on by whatever triggers
  // a reload (initial state, or a click), never synchronously by the effect.
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/report?days=${days}`)
        const d = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) setError(d?.error ?? "Couldn't build the report.")
        else { setReport(d); setError(null) }
      } catch {
        if (cancelled) return
        setError("Couldn't build the report — check your connection and try again.")
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [days, nonce])

  return (
    <div className="max-w-3xl">
      {/* ── Controls (never printed) ── */}
      <div className="print-hide">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary shrink-0" /> Health report
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setLoading(true); setNonce(n => n + 1) }}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Rebuild
            </button>
            {canPrint && (
              <button
                onClick={() => { if (!printPage(`Health report ${report?.from ?? ""}`)) setSent("This device can't print — email it instead.") }}
                disabled={loading || !report}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-secondary transition-colors"
              >
                <Printer className="h-3.5 w-3.5" />
                Print / Save as PDF
              </button>
            )}
            <button
              onClick={emailReport}
              disabled={loading || !report || sending}
              className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              {sent === "sent" ? <Check className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
              {sent === "sent" ? "Sent to your inbox" : sending ? "Sending…" : "Email it to me"}
            </button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          A one-page summary for an appointment — vitals, medications, symptoms, labs and the patterns that survived testing.
        </p>
        <div className="flex gap-1.5 mt-3 mb-6">
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => { if (p.days !== days) { setLoading(true); setDays(p.days) } }}
              className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                days === p.days ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4">{error}</p>}
        {sent && sent !== "sent" && (
          <p className="text-sm text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 mb-4">{sent}</p>
        )}
        {loading && (
          <div className="space-y-3 animate-pulse">
            {[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-secondary rounded-xl" />)}
          </div>
        )}
      </div>

      {/* ── The document itself ── */}
      {report && !loading && (
        <article className="report-doc text-sm leading-relaxed">
          <header className="report-section border-b-2 border-primary print:border-black pb-3">
            <h1 className="text-xl font-bold">Health summary</h1>
            <p className="text-muted-foreground print:text-black/70 text-[13px] mt-0.5">
              {report.user.name ?? "Patient"} · {fmtDay(report.from)} – {fmtDay(report.to)} ({report.periodDays} days)
            </p>
            <p className="text-[11px] text-muted-foreground/70 print:text-black/50 mt-0.5">
              {/* Spelled-out month and a 24-hour clock rather than the
                  browser's default. This page gets printed and handed to a
                  doctor, where "8/29/2026" is the 8th of September to half of
                  Europe, and the rest of the app has no 12-hour clock in it. */}
              Generated {new Intl.DateTimeFormat("en-GB", {
                day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit", hour12: false,
              }).format(new Date(report.generatedAt))} · Emergenthealth
            </p>
          </header>

          <p className="report-section mt-3 text-[11px] leading-snug text-muted-foreground print:text-black/70 border border-border print:border-black/20 rounded-lg print:rounded-none p-2.5">
            <strong>About this report.</strong> Self-tracked data from a personal health app, not a medical
            device or diagnostic tool. Vitals come from a consumer wearable (Oura ring); medications,
            symptoms and laboratory values were entered by the patient. Medication adherence counts only
            doses recorded in the app and is a lower bound. Nothing here is a diagnosis or a treatment
            recommendation.
          </p>

          {report.narrative && (
            <Section title="Summary">
              {report.narrative.split(/\n\s*\n/).map((p, i) => (
                <p key={i} className="mb-2">{p.trim()}</p>
              ))}
            </Section>
          )}

          <Section title="Data coverage">
            <p>
              Wearable data on <strong>{report.coverage.daysWithWearable} of {report.periodDays} days</strong>
              {report.coverage.longestGapDays > 1 && <> · longest uninterrupted gap {report.coverage.longestGapDays} days</>}.
              Averages below are computed only over days with a reading; missing days are not counted as zero.
            </p>
          </Section>

          {report.metrics.length > 0 && (
            <Section title="Vitals & sleep">
              <TableScroll>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Metric</th>
                    <th className={TH}>Mean</th>
                    <th className={TH}>Range</th>
                    <th className={TH}>Prev. period</th>
                    <th className={TH}>Change</th>
                    <th className={TH}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {report.metrics.map(m => (
                    <tr key={m.key} className="border-t border-border/50 print:border-black/10">
                      <td className={TD}>{m.label}</td>
                      <td className={`${TD} font-semibold`}>{m.avg}{m.unit}</td>
                      <td className={TD}>{m.min}–{m.max}</td>
                      <td className={TD}>{m.prevAvg != null ? `${m.prevAvg}${m.unit}` : "—"}</td>
                      <td className={TD}><Delta now={m.avg} prev={m.prevAvg} decimals={m.decimals} higherIsBetter={m.higherIsBetter} /></td>
                      <td className={TD}>{m.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Section>
          )}

          {report.meds.length > 0 && (
            <Section title="Medications">
              <TableScroll>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Medication</th>
                    <th className={TH}>Prescribed</th>
                    <th className={TH}>Typical taken</th>
                    <th className={TH}>Schedule</th>
                    <th className={TH}>Doses logged</th>
                    <th className={TH}>Last recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {report.meds.map(m => (
                    <tr key={m.name} className="border-t border-border/50 print:border-black/10">
                      <td className={TD}>{m.name}</td>
                      <td className={TD}>{m.dose ?? "—"}</td>
                      <td className={TD}>{m.typicalDose ?? "—"}</td>
                      <td className={TD}>{m.times.length ? m.times.join(", ") : "—"}{m.daysOfWeek.length > 0 && m.daysOfWeek.length < 7 ? " (some days)" : ""}</td>
                      <td className={TD}>{m.loggedDoses} of ~{m.expectedDoses}</td>
                      <td className={TD}>{m.lastTaken ? new Date(m.lastTaken).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Section>
          )}

          {report.symptoms.length > 0 && (
            <Section title="Symptoms reported">
              <TableScroll>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Symptom</th>
                    <th className={TH}>Times recorded</th>
                    <th className={TH}>Mean severity</th>
                    <th className={TH}>Worst</th>
                    <th className={TH}>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {report.symptoms.map(s => (
                    <tr key={s.name} className="border-t border-border/50 print:border-black/10">
                      <td className={TD}>{s.name}</td>
                      <td className={TD}>{s.occurrences}</td>
                      <td className={TD}>{s.avgSeverity}/5</td>
                      <td className={TD}>{s.worstSeverity}/5</td>
                      <td className={TD}>{fmtDay(s.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Section>
          )}

          {report.bloodPressure && (
            <Section title="Blood pressure">
              <TableScroll>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Mean</th>
                    <th className={TH}>Highest</th>
                    <th className={TH}>Most recent</th>
                    <th className={TH}>Readings</th>
                    <th className={TH}>Mean pulse</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border/50 print:border-black/10">
                    <td className={`${TD} font-semibold`}>
                      {report.bloodPressure.avgSystolic}/{report.bloodPressure.avgDiastolic}
                    </td>
                    <td className={TD}>{report.bloodPressure.maxSystolic}/{report.bloodPressure.maxDiastolic}</td>
                    <td className={TD}>
                      {report.bloodPressure.last.systolic}/{report.bloodPressure.last.diastolic}
                      <span className="text-muted-foreground print:text-black/60"> · {fmtDay(report.bloodPressure.last.date)}</span>
                    </td>
                    <td className={TD}>{report.bloodPressure.readings}</td>
                    <td className={TD}>{report.bloodPressure.avgPulse ?? "—"}</td>
                  </tr>
                </tbody>
              </table>
              </TableScroll>
              <p className="text-[11px] text-muted-foreground print:text-black/60 mt-1.5 leading-snug">
                Mean sits in the <strong>{report.bloodPressure.band}</strong> band by standard office
                thresholds. These are self-measured readings, which typically run lower than office
                readings — a prompt for discussion, not a diagnosis.
              </p>
            </Section>
          )}

          {report.weightTrend && (
            <Section title="Weight">
              <p>
                {report.weightTrend.first}kg → <strong>{report.weightTrend.last}kg</strong>{" "}
                ({report.weightTrend.changeKg >= 0 ? "+" : ""}{report.weightTrend.changeKg}kg over{" "}
                {report.periodDays} days, {report.weightTrend.readings} measurements).
              </p>
            </Section>
          )}

          {report.labs.length > 0 && (
            <Section title="Laboratory results">
              <TableScroll>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Marker</th>
                    <th className={TH}>Value</th>
                    <th className={TH}>Previous</th>
                    <th className={TH}>Reference</th>
                    <th className={TH}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {report.labs.map(l => (
                    <tr key={l.marker} className="border-t border-border/50 print:border-black/10">
                      <td className={TD}>{l.marker}</td>
                      <td className={`${TD} font-semibold ${l.flag === "high" || l.flag === "low" ? "text-red-600 dark:text-red-400" : ""}`}>
                        {l.value} {l.unit}
                        {l.flag === "high" && " ↑"}
                        {l.flag === "low" && " ↓"}
                      </td>
                      <td className={TD}>
                        {l.previous ? (
                          <>
                            {l.previous.value}
                            {" "}
                            <span className="text-muted-foreground print:text-black/60">
                              {l.value > l.previous.value ? "↑" : l.value < l.previous.value ? "↓" : "="}
                            </span>
                          </>
                        ) : "—"}
                      </td>
                      <td className={TD}>
                        {l.referenceMin != null || l.referenceMax != null
                          ? `${l.referenceMin ?? "—"} – ${l.referenceMax ?? "—"}`
                          : "not on file"}
                      </td>
                      <td className={TD}>{fmtDay(l.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Section>
          )}

          {report.body.weightKg != null && (
            <Section title="Body">
              <p>
                Weight {report.body.weightKg}kg
                {report.body.prevWeightKg != null && <> (previous measurement {report.body.prevWeightKg}kg)</>}
                {report.body.bodyFatPct != null && <> · body fat {report.body.bodyFatPct}%</>}
                {report.body.date && <> · recorded {fmtDay(report.body.date)}</>}.
              </p>
            </Section>
          )}

          {report.patterns.length > 0 && (
            <Section title="Observed associations">
              <p className="text-[11px] text-muted-foreground print:text-black/60 mb-1.5">
                Found by the app in this person&apos;s own data using a permutation test with
                false-discovery correction. Associations only — not evidence of cause.
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {report.patterns.map((p, i) => (
                  <li key={i}>
                    {p.finding} <span className="text-muted-foreground print:text-black/60">({p.confidence})</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <footer className="report-section mt-6 pt-2 border-t border-border print:border-black/30 text-[10px] text-muted-foreground print:text-black/50">
            Emergenthealth · personal health tracking · generated {new Date(report.generatedAt).toLocaleDateString()}
          </footer>
        </article>
      )}
    </div>
  )
}
