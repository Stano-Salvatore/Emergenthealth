"use client"

import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
  ComposedChart, Area, Cell,
} from "recharts"

const AXIS = { fill: "#9ca3af", fontSize: 10 } as const
const GRID = "rgba(255,255,255,0.05)"

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "6px 10px", fontSize: 11 }}>
      <p style={{ fontWeight: 600, marginBottom: 2 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? p.fill }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

export interface ChartDay {
  date: string       // e.g. "Apr 1"
  sleepH: number | null   // hours
  deepMin: number | null  // minutes
  remMin: number | null
  lightMin: number | null
  steps: number | null
  restingHR: number | null
  weight: number | null
  activeMin: number | null
  calories: number | null
}

export function SleepChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse()
  const hasStages = d.some(r => r.deepMin != null || r.remMin != null)
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground font-medium mb-2">Duration (hours) — dashed line = 7h goal</p>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} unit="h" domain={[0, 10]} />
            <Tooltip content={<Tip />} />
            <ReferenceLine y={7} stroke="#6366f1" strokeDasharray="4 2" strokeOpacity={0.6} />
            <Bar dataKey="sleepH" name="Sleep" radius={[3, 3, 0, 0]}>
              {d.map((row, i) => (
                <Cell key={i} fill={row.sleepH != null && row.sleepH >= 7 ? "#6366f1" : "#6366f155"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {hasStages && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Sleep stages (minutes)</p>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip />} />
              <Bar dataKey="deepMin" name="Deep" stackId="s" fill="#4338ca" radius={0} />
              <Bar dataKey="remMin" name="REM" stackId="s" fill="#818cf8" radius={0} />
              <Bar dataKey="lightMin" name="Light" stackId="s" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export function StepsChart({ data, goal = 8000 }: { data: ChartDay[]; goal?: number }) {
  const d = [...data].reverse().filter(r => r.steps != null)
  if (!d.length) return null
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Steps — dashed = {goal.toLocaleString()} goal</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${v / 1000}k` : String(v)} />
          <Tooltip content={<Tip />} />
          <ReferenceLine y={goal} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.6} />
          <Bar dataKey="steps" name="Steps" radius={[3, 3, 0, 0]}>
            {d.map((row, i) => (
              <Cell key={i} fill={row.steps != null && row.steps >= goal ? "#22c55e" : "#22c55e55"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ActivityChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.activeMin != null || r.calories != null)
  if (!d.length) return null
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Active minutes & calories burned</p>
      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={d} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis yAxisId="min" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis yAxisId="cal" orientation="right" tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip content={<Tip />} />
          <Bar yAxisId="min" dataKey="activeMin" name="Active min" fill="#f59e0b" fillOpacity={0.8} barSize={10} radius={[3, 3, 0, 0]} />
          <Line yAxisId="cal" type="monotone" dataKey="calories" name="Calories" stroke="#fb923c" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function HRChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.restingHR != null)
  if (!d.length) return null
  const vals = d.map(r => r.restingHR!).filter(Boolean)
  const min = Math.min(...vals) - 5
  const max = Math.max(...vals) + 5
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Resting heart rate (bpm)</p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={d} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={[min, max]} />
          <Tooltip content={<Tip />} />
          <Line type="monotone" dataKey="restingHR" name="HR" stroke="#ef4444" strokeWidth={2} dot={{ r: 2, fill: "#ef4444" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function WeightChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.weight != null)
  if (!d.length) return null
  const vals = d.map(r => r.weight!).filter(Boolean)
  const min = Math.min(...vals) - 1
  const max = Math.max(...vals) + 1
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Weight (kg)</p>
      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={d} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          <defs>
            <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={[min, max]} />
          <Tooltip content={<Tip />} />
          <Area type="monotone" dataKey="weight" name="Weight" fill="url(#wGrad)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2, fill: "#3b82f6" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
