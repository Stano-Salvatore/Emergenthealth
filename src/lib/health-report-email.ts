import type { HealthReport } from "@/lib/health-report"

// The report as a self-contained HTML email.
//
// The printable page is a React tree, and printing it needs a print stack the
// Android WebView does not have. Email needs neither: it arrives on the phone,
// on the laptop, and in whatever the doctor's office uses, and it can be
// forwarded or printed from a mail client that does have a print stack.
//
// Styling is inline and light-background on purpose — this is a clinical
// document that may well end up on paper, not a dashboard.

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ))
}

function fmtDay(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function num(v: number | null, decimals: number): string {
  if (v == null) return "—"
  return v.toFixed(decimals)
}

const TH = 'style="text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#666;padding:4px 10px 4px 0;border-bottom:1px solid #ddd"'
const TD = 'style="padding:5px 10px 5px 0;font-size:12px;color:#111;border-bottom:1px solid #f0f0f0;vertical-align:top"'

function section(title: string, inner: string): string {
  if (!inner) return ""
  return `<h2 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#3730a3;border-bottom:1px solid #ddd;padding-bottom:3px;margin:22px 0 8px">${esc(title)}</h2>${inner}`
}

export function reportSubject(report: HealthReport): string {
  return `Health report — ${fmtDay(report.from)} to ${fmtDay(report.to)}`
}

export function renderReportEmail(report: HealthReport): string {
  const r = report

  const metrics = r.metrics.length ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Metric</th><th ${TH}>Average</th><th ${TH}>Range</th><th ${TH}>Days</th></tr>
    ${r.metrics.map(m => `<tr>
      <td ${TD}>${esc(m.label)}</td>
      <td ${TD}><strong>${num(m.avg, m.decimals)}</strong> ${esc(m.unit)}</td>
      <td ${TD}>${num(m.min, m.decimals)}–${num(m.max, m.decimals)}</td>
      <td ${TD}>${m.days}</td>
    </tr>`).join("")}
  </table>
  <p style="font-size:10px;color:#888;margin:6px 0 0">Averages cover only the days with a reading; the Days column is that count, not the period length.</p>` : ""

  const meds = r.meds.length ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Medication</th><th ${TH}>Dose</th><th ${TH}>Schedule</th><th ${TH}>Taken</th></tr>
    ${r.meds.map(m => `<tr>
      <td ${TD}><strong>${esc(m.name)}</strong>${m.note ? `<br><span style="color:#777;font-size:11px">${esc(m.note)}</span>` : ""}</td>
      <td ${TD}>${esc(m.typicalDose ?? m.dose ?? "—")}</td>
      <td ${TD}>${esc(m.times.join(", ") || "as needed")}</td>
      <td ${TD}>${m.loggedDoses}${m.expectedDoses > 0 ? ` / ${m.expectedDoses}` : ""}${m.lastTaken ? `<br><span style="color:#777;font-size:11px">last ${esc(fmtDay(m.lastTaken))}</span>` : ""}</td>
    </tr>`).join("")}
  </table>` : ""

  const symptoms = r.symptoms.length ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Symptom</th><th ${TH}>Episodes</th><th ${TH}>Avg severity</th><th ${TH}>Worst</th><th ${TH}>Last</th></tr>
    ${r.symptoms.map(s => `<tr>
      <td ${TD}>${esc(s.name)}</td>
      <td ${TD}>${s.occurrences}</td>
      <td ${TD}>${s.avgSeverity.toFixed(1)}</td>
      <td ${TD}>${s.worstSeverity}</td>
      <td ${TD}>${esc(fmtDay(s.lastSeen))}</td>
    </tr>`).join("")}
  </table>` : ""

  const bp = r.bloodPressure ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Mean</th><th ${TH}>Highest</th><th ${TH}>Most recent</th><th ${TH}>Readings</th></tr>
    <tr>
      <td ${TD}><strong>${r.bloodPressure.avgSystolic}/${r.bloodPressure.avgDiastolic}</strong> mmHg<br><span style="color:#777;font-size:11px">${esc(r.bloodPressure.band)}</span></td>
      <td ${TD}>${r.bloodPressure.maxSystolic}/${r.bloodPressure.maxDiastolic}</td>
      <td ${TD}>${r.bloodPressure.last.systolic}/${r.bloodPressure.last.diastolic}<br><span style="color:#777;font-size:11px">${esc(fmtDay(r.bloodPressure.last.date))}</span></td>
      <td ${TD}>${r.bloodPressure.readings}${r.bloodPressure.avgPulse != null ? `<br><span style="color:#777;font-size:11px">mean pulse ${r.bloodPressure.avgPulse}</span>` : ""}</td>
    </tr>
  </table>
  <p style="font-size:10px;color:#888;margin:6px 0 0">Home readings; bands are the ESC/ESH office thresholds and do not translate directly.</p>` : ""

  const labs = r.labs.length ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Marker</th><th ${TH}>Result</th><th ${TH}>Previous</th><th ${TH}>Reference</th><th ${TH}>Date</th></tr>
    ${r.labs.map(l => {
      const colour = l.flag === "high" ? "#b45309" : l.flag === "low" ? "#1d4ed8" : "#111"
      const arrow = l.previous == null ? "—"
        : l.value > l.previous.value ? `↑ ${l.previous.value}`
        : l.value < l.previous.value ? `↓ ${l.previous.value}`
        : `= ${l.previous.value}`
      return `<tr>
        <td ${TD}>${esc(l.marker)}</td>
        <td ${TD}><strong style="color:${colour}">${l.value} ${esc(l.unit)}</strong></td>
        <td ${TD}>${esc(arrow)}${l.previous ? `<br><span style="color:#777;font-size:11px">${esc(fmtDay(l.previous.date))}</span>` : ""}</td>
        <td ${TD}>${l.referenceMin != null && l.referenceMax != null ? `${l.referenceMin}–${l.referenceMax}` : "—"}</td>
        <td ${TD}>${esc(fmtDay(l.date))}</td>
      </tr>`
    }).join("")}
  </table>` : ""

  const weight = r.weightTrend ? `<p style="font-size:12px;color:#111;margin:0">
    ${r.weightTrend.first.toFixed(1)} kg → <strong>${r.weightTrend.last.toFixed(1)} kg</strong>
    (${r.weightTrend.changeKg > 0 ? "+" : ""}${r.weightTrend.changeKg.toFixed(1)} kg over ${r.weightTrend.readings} weigh-ins)
    ${r.body.bodyFatPct != null ? ` · body fat ${r.body.bodyFatPct.toFixed(1)}%` : ""}
  </p>` : ""

  const patterns = r.patterns.length ? `<ul style="margin:0;padding-left:18px">
    ${r.patterns.map(p => `<li style="font-size:12px;color:#111;margin-bottom:4px">${esc(p.finding)}
      <span style="color:#777;font-size:10px;text-transform:uppercase;letter-spacing:0.06em"> · ${p.confidence}</span></li>`).join("")}
  </ul>
  <p style="font-size:10px;color:#888;margin:6px 0 0">Self-tracked associations from a single person's data, corrected for multiple comparisons. Associations, not causes.</p>` : ""

  const narrative = r.narrative
    ? r.narrative.split(/\n\s*\n/).map(p =>
        `<p style="font-size:12.5px;line-height:1.6;color:#111;margin:0 0 10px">${esc(p.trim())}</p>`
      ).join("")
    : ""

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:680px;margin:0 auto;padding:24px 18px;background:#ffffff">
    <div style="border-bottom:2px solid #3730a3;padding-bottom:10px;margin-bottom:4px">
      <h1 style="font-size:19px;margin:0;color:#111">Health report${r.user.name ? ` — ${esc(r.user.name)}` : ""}</h1>
      <p style="font-size:11px;color:#666;margin:5px 0 0">
        ${esc(fmtDay(r.from))} – ${esc(fmtDay(r.to))} · ${r.periodDays} days ·
        wearable data on ${r.coverage.daysWithWearable} of them${r.coverage.longestGapDays > 1 ? ` · longest gap ${r.coverage.longestGapDays} days` : ""}
      </p>
    </div>

    ${section("Summary", narrative)}
    ${section("Vitals and daily metrics", metrics)}
    ${section("Blood pressure", bp)}
    ${section("Medications", meds)}
    ${section("Symptoms", symptoms)}
    ${section("Laboratory results", labs)}
    ${section("Weight", weight)}
    ${section("Self-tracked patterns", patterns)}

    <p style="font-size:10px;color:#999;margin-top:26px;border-top:1px solid #eee;padding-top:10px;line-height:1.5">
      Generated by Emergenthealth on ${esc(new Date(r.generatedAt).toLocaleString("en-GB"))} from self-tracked and wearable data.
      Wearable figures are consumer-device estimates, not medical measurements. This document does not contain a diagnosis.
    </p>
  </div>
</body></html>`
}
