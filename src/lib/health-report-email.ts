import type { HealthReport } from "@/lib/health-report"
import { labValueText } from "@/lib/lab-flags"

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
      <td ${TD}>${m.days}${m.excludedDays ? `<br><span style="color:#777;font-size:11px">${m.excludedDays} more left out as the device not worn</span>` : ""}</td>
    </tr>`).join("")}
  </table>
  <p style="font-size:10px;color:#888;margin:6px 0 0">Averages cover only the days with a reading; the Days column is that count, not the period length.</p>` : ""

  const meds = r.meds.length ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Medication</th><th ${TH}>Dose</th><th ${TH}>Schedule</th><th ${TH}>Logged in app</th></tr>
    ${r.meds.map(m => `<tr>
      <td ${TD}><strong>${esc(m.name)}</strong>${m.stopped ? ` <span style="color:#a15c00;font-size:11px">(stopped)</span>` : ""}${m.note ? `<br><span style="color:#777;font-size:11px">${esc(m.note)}</span>` : ""}</td>
      <td ${TD}>${esc(m.typicalDose ?? m.dose ?? "—")}</td>
      <td ${TD}>${esc(m.times.join(", ") || "as needed")}</td>
      <td ${TD}>${m.loggedDoses}${m.expectedDoses > 0 ? ` / ${m.expectedDoses}` : ""}${m.lastTaken ? `<br><span style="color:#777;font-size:11px">last ${esc(fmtDay(m.lastTaken))}</span>` : ""}</td>
    </tr>`).join("")}
  </table>
  <p style="font-size:10px;color:#888;margin:6px 0 0">Counts only doses recorded in the app, so it is a lower bound on what was taken.</p>` : ""

  const otherDoses = r.otherDoses.length ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Taken</th><th ${TH}>Doses</th><th ${TH}>Days</th><th ${TH}>Typical</th><th ${TH}>Last</th></tr>
    ${r.otherDoses.map(o => `<tr>
      <td ${TD}><strong>${esc(o.name)}</strong></td>
      <td ${TD}>${o.count}</td>
      <td ${TD}>${o.days}</td>
      <td ${TD}>${esc(o.typicalDose ?? "—")}</td>
      <td ${TD}>${esc(fmtDay(o.lastTaken))}</td>
    </tr>`).join("")}
  </table>
  <p style="font-size:10px;color:#888;margin:6px 0 0">Medicines and supplements recorded with no schedule — as-needed use, one-offs — as the patient logged them.</p>` : ""

  const symptoms = r.symptoms.length ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Symptom</th><th ${TH}>Episodes</th><th ${TH}>Avg severity</th><th ${TH}>Worst</th><th ${TH}>Last</th></tr>
    ${r.symptoms.map(s => `<tr>
      <td ${TD}>${esc(s.name)}</td>
      <td ${TD}>${s.occurrences}</td>
      <td ${TD}>${s.avgSeverity.toFixed(1)}/5</td>
      <td ${TD}>${s.worstSeverity}/5</td>
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

  const c = r.cycle
  const cycle = c ? `<p style="font-size:12px;color:#111;margin:0">
    ${c.lastPeriodStart ? `Last period started <strong>${esc(fmtDay(c.lastPeriodStart))}</strong>${c.cycleDay != null ? ` (cycle day ${c.cycleDay} on the report date)` : ""}.` : "No period start logged."}
    ${c.basis === "personal" ? `Cycles median <strong>${c.cycleLength} days</strong>${c.range ? ` (${c.range[0]}–${c.range[1]})` : ""} over ${c.cyclesLogged} logged cycles` : `Cycle length ${c.cycleLength} days (${c.basis === "entered" ? "the patient's own estimate" : "default; too few cycles logged"})`};
    periods about ${c.periodLength} days. Contraception: ${esc(c.contraception)}.
  </p>
  <p style="font-size:11px;color:#555;margin:4px 0 0">In this period: ${c.periods.length} period${c.periods.length === 1 ? "" : "s"} logged${c.periods.length ? ` (${c.periods.map(p => `${esc(fmtDay(p.start))}, ${p.days} days`).join("; ")})` : ""} · ${c.heavyDays} heavy-flow day${c.heavyDays === 1 ? "" : "s"} · ${c.painfulDays} day${c.painfulDays === 1 ? "" : "s"} of moderate or severe pain · ${c.betweenBleedingDays} day${c.betweenBleedingDays === 1 ? "" : "s"} of bleeding between periods.</p>` : ""

  const labs = r.labs.length ? `<table style="width:100%;border-collapse:collapse">
    <tr><th ${TH}>Marker</th><th ${TH}>Result</th><th ${TH}>Previous</th><th ${TH}>Reference</th><th ${TH}>Date</th></tr>
    ${r.labs.map(l => {
      const colour = l.flag === "high" ? "#b45309" : l.flag === "low" ? "#1d4ed8" : "#111"
      // The arrow is the builder's verdict in the latest unit, never a raw
      // comparison: 200 mg/dL beside 5.2 mmol/L is flat, not a fall.
      const p = l.previous
      const arrow = p == null ? "—"
        : p.unitMismatch ? `${labValueText(p.value, p.qualifier)} ${p.unit} (different unit)`
        : `${p.direction === "up" ? "↑ " : p.direction === "down" ? "↓ " : p.direction === "flat" ? "≈ " : ""}${labValueText(p.valueInLatestUnit ?? p.value, p.qualifier)}${p.unit !== l.unit ? ` ${l.unit}` : ""}${p.direction === "flat" ? " (within normal variation)" : ""}`
      return `<tr>
        <td ${TD}>${esc(l.marker)}</td>
        <td ${TD}><strong style="color:${colour}">${esc(labValueText(l.value, l.qualifier))} ${esc(l.unit)}</strong></td>
        <td ${TD}>${esc(arrow)}${l.previous ? `<br><span style="color:#777;font-size:11px">${esc(fmtDay(l.previous.date))}</span>` : ""}</td>
        <td ${TD}>${l.referenceMin != null && l.referenceMax != null ? `${l.referenceMin}–${l.referenceMax}` : "—"}</td>
        <td ${TD}>${esc(fmtDay(l.date))}</td>
      </tr>`
    }).join("")}
  </table>` : ""

  const bodyFat = r.body.bodyFatPct != null
    ? ` · body fat ${r.body.bodyFatPct.toFixed(1)}%${r.body.bodyFatDate ? ` (${esc(fmtDay(r.body.bodyFatDate))})` : ""}`
    : ""
  const weight = r.weightTrend ? `<p style="font-size:12px;color:#111;margin:0">
    ${r.weightTrend.first.toFixed(1)} kg → <strong>${r.weightTrend.last.toFixed(1)} kg</strong>
    (${r.weightTrend.changeKg > 0 ? "+" : ""}${r.weightTrend.changeKg.toFixed(1)} kg between ${esc(fmtDay(r.weightTrend.firstDate))} and ${esc(fmtDay(r.weightTrend.lastDate))}, ${r.weightTrend.readings} weigh-ins)
    ${bodyFat}
  </p>`
    // Fewer than two weigh-ins in the period still leaves a latest one, and a
    // doctor is better served by it, dated, than by no weight at all.
    : r.body.weightKg != null ? `<p style="font-size:12px;color:#111;margin:0">
    Latest <strong>${r.body.weightKg.toFixed(1)} kg</strong>${r.body.date ? `, recorded ${esc(fmtDay(r.body.date))}` : ""}
    ${r.body.prevWeightKg != null ? ` (previous ${r.body.prevWeightKg.toFixed(1)} kg)` : ""}${bodyFat}
  </p>` : ""

  const patterns = r.patterns.length ? `<ul style="margin:0;padding-left:18px">
    ${r.patterns.map(p => `<li style="font-size:12px;color:#111;margin-bottom:4px">${esc(p.finding)}
      <span style="color:#777;font-size:10px;text-transform:uppercase;letter-spacing:0.06em"> · ${p.confidence}</span>${p.days ? `<span style="color:#777;font-size:11px"> · ${p.days.with} days with, ${p.days.without} without</span>` : ""}
      ${p.coverage ? `<br><span style="color:#777;font-size:11px">${esc(p.coverage)}</span>` : ""}
      ${p.confounded ? `<br><span style="color:#777;font-size:11px">${esc(p.confounded)}</span>` : ""}</li>`).join("")}
  </ul>
  <p style="font-size:10px;color:#888;margin:6px 0 0">Self-tracked associations from a single person's data, computed over the 90 days before ${r.patternsAsOf ? esc(fmtDay(r.patternsAsOf)) : "the last analysis"} rather than this report's period, and corrected for multiple comparisons. Associations, not causes.</p>` : ""

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

    <p style="font-size:11px;line-height:1.5;color:#555;border:1px solid #ddd;padding:8px 10px;margin:14px 0 0">
      <strong>About this report.</strong> Self-tracked data from a personal health app, not a medical
      device or diagnostic tool. Vitals come from a consumer wearable (Oura ring); medications,
      symptoms and laboratory values were entered by the patient. Medication adherence counts only
      doses recorded in the app and is a lower bound. Nothing here is a diagnosis or a treatment
      recommendation.
    </p>

    ${section("Summary", narrative)}
    ${section("Vitals and daily metrics", metrics)}
    ${section("Blood pressure", bp)}
    ${section("Medications", meds)}
    ${section("Other doses logged", otherDoses)}
    ${section("Symptoms", symptoms)}
    ${section("Menstrual cycle", cycle)}
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
