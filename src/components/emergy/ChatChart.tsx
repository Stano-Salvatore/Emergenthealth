"use client"

import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Cell,
} from "recharts"

// A chart small enough to live inside a chat bubble.
//
// One series, so one hue — the app's own `--primary`, the same one the Health
// page draws sleep in, which is what keeps two views of the same week from
// looking like two different metrics. No legend: with a single series the
// caption names it, and a legend box would take a third of the height. No
// number on the bars either; seven labels do not fit at 390px, so the axis
// carries the shape and the tooltip carries the value.
//
// Status hues are deliberately absent. Green means "on target" everywhere in
// this app, and a red bar under a sentence that is only reporting a number
// would be the chart drawing a conclusion the words did not.
//
// The data never comes from the reply. It is fetched from /api/chat/chart,
// which resolves a whitelisted spec against the database — see the note there.

interface Point { day: string; hours: number | null; score: number | null }
interface ChartData { spec: string; goalH: number; points: Point[] }

function readCSSVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function isLight() {
  return document.documentElement.classList.contains("light")
}

/** Hairline, one shade off the surface — never dashed; a dashed grid reads as a threshold. */
function grid() {
  return isLight() ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.06)"
}

function axisFill() {
  return readCSSVar("--muted-foreground") || (isLight() ? "#6b7280" : "#9ca3af")
}

/** Re-resolves --primary when the theme or accent changes, as the Health charts do. */
function usePrimary() {
  const [color, setColor] = useState("#6366f1")
  useEffect(() => {
    const update = () => setColor(readCSSVar("--primary") || "#6366f1")
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-accent", "data-theme", "class"] })
    return () => obs.disconnect()
  }, [])
  return color
}

/**
 * Two letters, not one. The narrow weekday gives "S" for both Saturday and
 * Sunday and "T" for both Tuesday and Thursday, so four of seven bars on a
 * sleep week were unlabelled in practice. Two characters still fit seven times
 * across a 390px phone.
 */
function initial(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .slice(0, 2)
}

function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

function hm(hours: number): string {
  const total = Math.round(hours * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`
}

interface TipProps { active?: boolean; payload?: { payload: Point }[] }

function Tip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
      <p className="font-medium">{longDay(p.day)}</p>
      <p className="text-muted-foreground tabular-nums">
        {p.hours == null ? "No data" : hm(p.hours)}
        {p.score != null && ` · score ${p.score}`}
      </p>
    </div>
  )
}

export function ChatChart({ spec }: { spec: string }) {
  const [data, setData] = useState<ChartData | null>(null)
  const [failed, setFailed] = useState(false)
  const primary = usePrimary()

  useEffect(() => {
    let live = true
    fetch(`/api/chat/chart?spec=${encodeURIComponent(spec)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error("no chart"))))
      .then(d => { if (live) setData(d) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [spec])

  // A chart the app cannot back renders nothing at all. The words around it
  // stand on their own, which is why they are written to.
  if (failed || !data) return null
  const nights = data.points.filter(p => p.hours != null)
  if (nights.length === 0) return null

  const dim = primary + "59" // ~35%, for a night under the goal
  const tick = { fill: axisFill(), fontSize: 10 }
  const max = Math.max(data.goalH + 1, ...nights.map(p => p.hours ?? 0))

  return (
    <figure className="my-2">
      <figcaption className="text-xs text-muted-foreground mb-1.5">
        Sleep, last 7 nights — dashed line is your {data.goalH}h goal
      </figcaption>
      {/* Height covers the plot and the axis band, so the bubble never gets a nested scrollbar. */}
      <ResponsiveContainer width="100%" height={132}>
        <BarChart data={data.points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={grid()} />
          <XAxis dataKey="day" tickFormatter={initial} tick={tick} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={tick} axisLine={false} tickLine={false} unit="h" width={26} domain={[0, Math.ceil(max)]} allowDecimals={false} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(127,127,127,0.08)" }} />
          <ReferenceLine y={data.goalH} stroke={primary} strokeDasharray="4 2" strokeOpacity={0.6} />
          {/* 4px rounded top, square at the baseline it grows from; capped thin. */}
          <Bar dataKey="hours" name="Sleep" radius={[4, 4, 0, 0]} maxBarSize={18}>
            {data.points.map((p, i) => (
              <Cell key={i} fill={p.hours != null && p.hours >= data.goalH ? primary : dim} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}
