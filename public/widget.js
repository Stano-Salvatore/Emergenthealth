// ─────────────────────────────────────────────────────────────────────────────
// Emergenthealth Widget for Scriptable
// https://scriptable.app  (free on App Store)
//
// SETUP:
//  1. Install Scriptable from the App Store
//  2. Open the app → tap + → paste this entire script
//  3. Fill in BASE_URL and API_KEY below
//     (API key: dashboard → Settings → scroll to "API Keys" → copy any key)
//  4. Long-press your home screen → + → Scriptable → choose size → done
//  5. For lock screen: edit lock screen → + → Scriptable → choose accessory size
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = "https://emergenthealth.vercel.app" // ← your app URL
const API_KEY  = ""                                   // ← paste API key here

// ── Colours ──────────────────────────────────────────────────────────────────
const C = {
  bg:       new Color("#09090f"),
  card:     new Color("#100f1a"),
  primary:  new Color("#6366f1"),
  muted:    new Color("#7a7a96"),
  white:    new Color("#f2f2fa"),
  green:    new Color("#22c55e"),
  yellow:   new Color("#eab308"),
  red:      new Color("#ef4444"),
  pink:     new Color("#ec4899"),
}

// ── Fetch data ────────────────────────────────────────────────────────────────
async function fetchData() {
  if (!API_KEY) return null
  try {
    const req = new Request(`${BASE_URL}/api/widget`)
    req.headers = { "Authorization": `Bearer ${API_KEY}` }
    req.timeoutInterval = 10
    return await req.loadJSON()
  } catch { return null }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function moodEmoji(v) {
  if (!v) return "—"
  return ["😞","😕","😐","🙂","😄"][Math.min(4, Math.max(0, Math.round(v) - 1))]
}

function fmt(n, unit = "") {
  if (n == null) return "—"
  return n.toLocaleString() + (unit ? " " + unit : "")
}

function ringPath(pct, size, strokeW, fg, bg) {
  // Draw a simple arc using a DrawContext (approx with filled rects for Scriptable)
  const dc = new DrawContext()
  dc.size = new Size(size, size)
  dc.opaque = false
  dc.respectScreenScale = true

  const cx = size / 2, cy = size / 2, r = (size - strokeW) / 2
  const toRad = deg => (deg - 90) * (Math.PI / 180)
  const endDeg = 360 * Math.min(pct / 100, 1)

  // Background ring
  const bgPath = new Path()
  bgPath.addEllipse(new Rect(strokeW/2, strokeW/2, size-strokeW, size-strokeW))
  dc.setFillColor(new Color("#ffffff", 0))
  dc.setStrokeColor(bg)
  dc.setLineWidth(strokeW)
  dc.addPath(bgPath)
  dc.strokePath()

  // Foreground arc (approximate with lines)
  const steps = Math.max(2, Math.round(endDeg / 5))
  const fgPath = new Path()
  for (let i = 0; i <= steps; i++) {
    const angle = toRad((endDeg * i) / steps)
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    if (i === 0) fgPath.move(new Point(x, y))
    else fgPath.addLine(new Point(x, y))
  }
  dc.setStrokeColor(fg)
  dc.setLineWidth(strokeW)
  dc.setLineCap ? dc.setLineCap("round") : null
  dc.addPath(fgPath)
  dc.strokePath()

  return dc.getImage()
}

// ── Small widget (steps + sleep) ──────────────────────────────────────────────
async function buildSmall(d) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(14, 14, 14, 14)

  if (!d) {
    const t = w.addText("No data")
    t.textColor = C.muted
    t.font = Font.systemFont(13)
    return w
  }

  // Header
  const header = w.addStack()
  const dot = header.addText("◉")
  dot.textColor = C.primary
  dot.font = Font.boldSystemFont(10)
  header.addSpacer(4)
  const title = header.addText("Health")
  title.textColor = C.muted
  title.font = Font.mediumSystemFont(11)
  header.addSpacer()
  if (d.weather) {
    const wt = header.addText(d.weather.emoji)
    wt.font = Font.systemFont(12)
  }

  w.addSpacer(8)

  // Steps
  const stepsVal = w.addText(d.steps != null ? d.steps.toLocaleString() : "—")
  stepsVal.textColor = C.white
  stepsVal.font = Font.boldSystemFont(28)
  stepsVal.minimumScaleFactor = 0.7

  const stepsLbl = w.addText("steps" + (d.stepsPercent != null ? `  ${d.stepsPercent}%` : ""))
  stepsLbl.textColor = d.stepsPercent >= 100 ? C.green : C.muted
  stepsLbl.font = Font.systemFont(11)

  w.addSpacer(8)

  // Sleep
  const sleepRow = w.addStack()
  sleepRow.layoutVertically()
  const sleepVal = sleepRow.addText(d.sleepHours != null ? `${d.sleepHours}h` : "—")
  sleepVal.textColor = d.sleepHours >= 7 ? C.primary : C.yellow
  sleepVal.font = Font.boldSystemFont(18)
  const sleepLbl = sleepRow.addText("sleep" + (d.sleepScore ? `  ${d.sleepScore}` : ""))
  sleepLbl.textColor = C.muted
  sleepLbl.font = Font.systemFont(10)

  w.addSpacer()

  return w
}

// ── Medium widget ─────────────────────────────────────────────────────────────
async function buildMedium(d) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(14, 16, 14, 16)

  if (!d) {
    const t = w.addText("Set API_KEY in the script to get started.")
    t.textColor = C.muted
    t.font = Font.systemFont(13)
    t.lineLimit = 3
    return w
  }

  // Header row
  const hdr = w.addStack()
  hdr.layoutHorizontally()
  hdr.centerAlignContent()
  const dot = hdr.addText("◉  Emergenthealth")
  dot.textColor = C.primary
  dot.font = Font.boldSystemFont(11)
  hdr.addSpacer()
  const dateStr = new Date().toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })
  const dateTxt = hdr.addText(dateStr + (d.weather ? "  " + d.weather.emoji : ""))
  dateTxt.textColor = C.muted
  dateTxt.font = Font.systemFont(11)

  w.addSpacer(10)

  // Metrics row
  const row = w.addStack()
  row.layoutHorizontally()
  row.spacing = 0

  function metricCell(parent, value, label, color) {
    const cell = parent.addStack()
    cell.layoutVertically()
    const v = cell.addText(value)
    v.textColor = color
    v.font = Font.boldSystemFont(22)
    v.minimumScaleFactor = 0.6
    const l = cell.addText(label)
    l.textColor = C.muted
    l.font = Font.systemFont(10)
    return cell
  }

  metricCell(row, d.steps != null ? d.steps.toLocaleString() : "—",
    "steps", d.stepsPercent >= 100 ? C.green : C.white)
  row.addSpacer()

  metricCell(row, d.sleepHours != null ? `${d.sleepHours}h` : "—",
    `sleep${d.sleepScore ? "  " + d.sleepScore : ""}`,
    d.sleepHours >= 7 ? C.primary : C.yellow)
  row.addSpacer()

  metricCell(row, d.readiness != null ? String(d.readiness) : "—",
    "readiness",
    d.readiness >= 70 ? C.green : d.readiness >= 50 ? C.yellow : C.red)
  row.addSpacer()

  metricCell(row, d.mood != null ? moodEmoji(d.mood) : "—",
    "mood", C.white)

  w.addSpacer(10)

  // Habits + HRV row
  const row2 = w.addStack()
  row2.layoutHorizontally()
  row2.centerAlignContent()

  if (d.habitsTotal > 0) {
    const habStr = `${d.habitsCompleted}/${d.habitsTotal} habits`
    const hab = row2.addText(habStr)
    hab.textColor = d.habitsPercent >= 100 ? C.green : C.muted
    hab.font = Font.systemFont(11)
  }

  row2.addSpacer()

  if (d.hrv) {
    const hrv = row2.addText(`HRV ${d.hrv} ms`)
    hrv.textColor = C.muted
    hrv.font = Font.systemFont(11)
  }

  if (d.weather) {
    row2.addSpacer(6)
    const temp = row2.addText(`${d.weather.temp}°`)
    temp.textColor = C.muted
    temp.font = Font.systemFont(11)
  }

  w.addSpacer()

  return w
}

// ── Large widget ──────────────────────────────────────────────────────────────
async function buildLarge(d) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(16, 16, 16, 16)

  if (!d) {
    const t = w.addText("Set API_KEY in the script to get started.")
    t.textColor = C.muted
    t.font = Font.systemFont(13)
    return w
  }

  // Title
  const hdr = w.addStack()
  hdr.layoutHorizontally()
  hdr.centerAlignContent()
  const title = hdr.addText("◉  Emergenthealth")
  title.textColor = C.primary
  title.font = Font.boldSystemFont(13)
  hdr.addSpacer()
  const dateStr = new Date().toLocaleDateString("en", { weekday: "long", month: "short", day: "numeric" })
  const dateTxt = hdr.addText(dateStr)
  dateTxt.textColor = C.muted
  dateTxt.font = Font.systemFont(11)

  w.addSpacer(12)

  // Main metrics grid
  function bigCell(parent, emoji, value, label, color) {
    const cell = parent.addStack()
    cell.layoutVertically()
    cell.backgroundColor = C.card
    cell.cornerRadius = 10
    cell.setPadding(10, 10, 10, 10)
    const emojiTxt = cell.addText(emoji)
    emojiTxt.font = Font.systemFont(18)
    cell.addSpacer(4)
    const v = cell.addText(value)
    v.textColor = color
    v.font = Font.boldSystemFont(18)
    v.minimumScaleFactor = 0.6
    const l = cell.addText(label)
    l.textColor = C.muted
    l.font = Font.systemFont(10)
    return cell
  }

  const grid1 = w.addStack()
  grid1.layoutHorizontally()
  grid1.spacing = 8

  bigCell(grid1, "👟",
    d.steps != null ? d.steps.toLocaleString() : "—",
    `steps · ${d.stepsPercent ?? 0}%`,
    d.stepsPercent >= 100 ? C.green : C.white)

  bigCell(grid1, "😴",
    d.sleepHours != null ? `${d.sleepHours}h` : "—",
    `sleep · ${d.sleepScore ?? "—"}`,
    d.sleepHours >= 7 ? C.primary : C.yellow)

  w.addSpacer(8)

  const grid2 = w.addStack()
  grid2.layoutHorizontally()
  grid2.spacing = 8

  bigCell(grid2, "⚡",
    d.readiness != null ? String(d.readiness) : "—",
    "readiness",
    d.readiness >= 70 ? C.green : d.readiness >= 50 ? C.yellow : C.red)

  bigCell(grid2, "💓",
    d.hrv != null ? `${d.hrv} ms` : "—",
    "HRV",
    C.pink)

  w.addSpacer(12)

  // Habits bar
  if (d.habitsTotal > 0) {
    const habRow = w.addStack()
    habRow.layoutHorizontally()
    habRow.centerAlignContent()
    const habLbl = habRow.addText(`Habits  ${d.habitsCompleted}/${d.habitsTotal}`)
    habLbl.textColor = C.white
    habLbl.font = Font.mediumSystemFont(12)
    habRow.addSpacer()
    const habPct = habRow.addText(`${d.habitsPercent}%`)
    habPct.textColor = d.habitsPercent >= 80 ? C.green : C.muted
    habPct.font = Font.boldSystemFont(12)
    w.addSpacer(6)
  }

  // Mood + energy row
  const row3 = w.addStack()
  row3.layoutHorizontally()
  row3.centerAlignContent()

  if (d.mood) {
    const moodTxt = row3.addText(`Mood  ${moodEmoji(d.mood)}`)
    moodTxt.textColor = C.muted
    moodTxt.font = Font.systemFont(12)
  }
  row3.addSpacer()
  if (d.energy) {
    const enTxt = row3.addText(`Energy  ${"⚡".repeat(d.energy)}`)
    enTxt.textColor = C.muted
    enTxt.font = Font.systemFont(12)
  }

  if (d.intention) {
    w.addSpacer(8)
    const intentRow = w.addStack()
    intentRow.backgroundColor = new Color("#6366f1", 0.08)
    intentRow.cornerRadius = 8
    intentRow.setPadding(8, 10, 8, 10)
    const intentTxt = intentRow.addText(`"${d.intention}"`)
    intentTxt.textColor = new Color("#a5b4fc")
    intentTxt.font = Font.italicSystemFont(12)
    intentTxt.lineLimit = 2
  }

  w.addSpacer()

  return w
}

// ── Lock screen: circular (readiness ring) ────────────────────────────────────
async function buildAccessoryCircular(d) {
  const w = new ListWidget()
  w.backgroundColor = C.bg

  if (!d || d.readiness == null) {
    const t = w.addText("—")
    t.textColor = C.muted
    t.font = Font.boldSystemFont(18)
    t.centerAlignText()
    return w
  }

  const stack = w.addStack()
  stack.layoutVertically()
  stack.centerAlignContent()

  const val = stack.addText(String(d.readiness))
  val.textColor = d.readiness >= 70 ? C.green : d.readiness >= 50 ? C.yellow : C.red
  val.font = Font.boldSystemFont(18)
  val.centerAlignText()

  const lbl = stack.addText("RDY")
  lbl.textColor = C.muted
  lbl.font = Font.systemFont(9)
  lbl.centerAlignText()

  return w
}

// ── Lock screen: rectangular (steps + sleep) ──────────────────────────────────
async function buildAccessoryRectangular(d) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(0, 2, 0, 2)

  if (!d) {
    const t = w.addText("Emergenthealth")
    t.textColor = C.muted
    t.font = Font.systemFont(11)
    return w
  }

  const r1 = w.addStack()
  r1.layoutHorizontally()
  r1.centerAlignContent()

  const stepsTxt = r1.addText(`👟 ${d.steps != null ? d.steps.toLocaleString() : "—"}`)
  stepsTxt.textColor = C.white
  stepsTxt.font = Font.boldSystemFont(12)
  r1.addSpacer()
  if (d.stepsPercent != null) {
    const pct = r1.addText(`${d.stepsPercent}%`)
    pct.textColor = d.stepsPercent >= 100 ? C.green : C.muted
    pct.font = Font.systemFont(11)
  }

  w.addSpacer(2)

  const r2 = w.addStack()
  r2.layoutHorizontally()
  r2.centerAlignContent()

  const sleepTxt = r2.addText(`😴 ${d.sleepHours != null ? d.sleepHours + "h" : "—"}`)
  sleepTxt.textColor = C.white
  sleepTxt.font = Font.boldSystemFont(12)
  r2.addSpacer()
  if (d.readiness != null) {
    const rdyTxt = r2.addText(`⚡ ${d.readiness}`)
    rdyTxt.textColor = d.readiness >= 70 ? C.green : C.muted
    rdyTxt.font = Font.systemFont(11)
  }

  w.addSpacer(2)

  const r3 = w.addStack()
  r3.layoutHorizontally()
  r3.centerAlignContent()

  if (d.habitsTotal > 0) {
    const habTxt = r3.addText(`✅ ${d.habitsCompleted}/${d.habitsTotal} habits`)
    habTxt.textColor = C.muted
    habTxt.font = Font.systemFont(11)
  }
  r3.addSpacer()
  if (d.mood) {
    const moodTxt = r3.addText(moodEmoji(d.mood))
    moodTxt.font = Font.systemFont(12)
  }

  return w
}

// ── Lock screen: inline (one-liner) ──────────────────────────────────────────
async function buildAccessoryInline(d) {
  const w = new ListWidget()
  if (!d) {
    const t = w.addText("No data")
    t.textColor = C.muted
    t.font = Font.systemFont(11)
    return w
  }
  const parts = []
  if (d.steps != null) parts.push(`${d.steps.toLocaleString()} steps`)
  if (d.sleepHours != null) parts.push(`${d.sleepHours}h sleep`)
  if (d.readiness != null) parts.push(`RDY ${d.readiness}`)
  const t = w.addText(parts.join("  ·  ") || "Emergenthealth")
  t.textColor = C.white
  t.font = Font.systemFont(11)
  return w
}

// ── Main ──────────────────────────────────────────────────────────────────────
const data = await fetchData()
const family = config.widgetFamily

let widget
if      (family === "accessoryCircular")    widget = await buildAccessoryCircular(data)
else if (family === "accessoryRectangular") widget = await buildAccessoryRectangular(data)
else if (family === "accessoryInline")      widget = await buildAccessoryInline(data)
else if (family === "systemLarge")          widget = await buildLarge(data)
else if (family === "systemMedium")         widget = await buildMedium(data)
else                                        widget = await buildSmall(data)

if (!config.runsInWidget) {
  // Preview all sizes when running in-app
  await widget.presentMedium()
}

Script.setWidget(widget)
Script.complete()
