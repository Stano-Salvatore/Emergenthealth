"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Trash2, ChevronDown, ChevronUp } from "lucide-react"

interface Measurement {
  id: string
  date: string
  weightKg: number | null
  waistCm: number | null
  hipsCm: number | null
  chestCm: number | null
  neckCm: number | null
  bodyFatPct: number | null
  musclePct: number | null
  bmi: number | null
  notes: string | null
  source: string | null
}

interface ApiResponse {
  measurements: Measurement[]
  heightCm: number | null
}

function bmiLabel(bmi: number): { label: string; color: string } {
  if (bmi < 18.5) return { label: "Underweight", color: "text-yellow-400" }
  if (bmi < 25) return { label: "Normal", color: "text-green-400" }
  if (bmi < 30) return { label: "Overweight", color: "text-orange-400" }
  return { label: "Obese", color: "text-red-400" }
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-muted-foreground text-xs">—</span>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100
    const y = 30 - ((v - min) / range) * 26
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(" ")
  return (
    <svg viewBox="0 0 100 30" className="w-20 h-8" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="text-primary" />
    </svg>
  )
}

function DeltaBadge({ current, prev, unit }: { current: number; prev: number | null; unit: string }) {
  if (prev === null) return null
  const diff = Math.round((current - prev) * 10) / 10
  if (Math.abs(diff) < 0.01) return <span className="text-xs text-muted-foreground">no change</span>
  const positive = diff > 0
  return (
    <span className={cn("text-xs font-medium", positive ? "text-red-400" : "text-green-400")}>
      {positive ? "↑" : "↓"} {Math.abs(diff)}{unit}
    </span>
  )
}

type MetricKey = "weightKg" | "waistCm" | "hipsCm" | "chestCm" | "neckCm" | "bodyFatPct" | "musclePct" | "bmi"

const METRICS: { key: MetricKey; label: string; unit: string }[] = [
  { key: "weightKg", label: "Weight", unit: " kg" },
  { key: "waistCm", label: "Waist", unit: " cm" },
  { key: "bodyFatPct", label: "Body Fat", unit: "%" },
  { key: "musclePct", label: "Muscle", unit: "%" },
  { key: "hipsCm", label: "Hips", unit: " cm" },
  { key: "chestCm", label: "Chest", unit: " cm" },
  { key: "neckCm", label: "Neck", unit: " cm" },
  { key: "bmi", label: "BMI", unit: "" },
]

export default function BodyPage() {
  const [data, setData] = useState<ApiResponse>({ measurements: [], heightCm: null })
  const [loading, setLoading] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [heightInput, setHeightInput] = useState("")
  const [savingHeight, setSavingHeight] = useState(false)

  const _td = new Date()
  const today = [_td.getFullYear(), String(_td.getMonth()+1).padStart(2,"0"), String(_td.getDate()).padStart(2,"0")].join("-")
  const [form, setForm] = useState({
    date: today,
    weightKg: "",
    waistCm: "",
    hipsCm: "",
    chestCm: "",
    neckCm: "",
    bodyFatPct: "",
    musclePct: "",
    notes: "",
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/body")
      const json = await res.json()
      setData(json)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function num(s: string) {
    const v = parseFloat(s)
    return isNaN(v) ? undefined : v
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg(null)
    try {
      const body: Record<string, unknown> = { date: form.date }
      const fields: (keyof typeof form)[] = ["weightKg", "waistCm", "hipsCm", "chestCm", "neckCm", "bodyFatPct", "musclePct"]
      for (const f of fields) {
        const v = num(form[f] as string)
        if (v !== undefined) body[f] = v
      }
      if (form.notes.trim()) body.notes = form.notes.trim()

      const res = await fetch("/api/body", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSaveMsg("Saved!")
        setForm(f => ({ ...f, weightKg: "", waistCm: "", hipsCm: "", chestCm: "", neckCm: "", bodyFatPct: "", musclePct: "", notes: "" }))
        await load()
      } else {
        setSaveMsg("Error saving")
      }
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 2500)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await fetch("/api/body", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
      await load()
    } finally {
      setDeleting(null)
    }
  }

  async function saveHeight() {
    const h = parseFloat(heightInput)
    if (!h || h < 50 || h > 300) return
    setSavingHeight(true)
    try {
      await fetch("/api/body/height", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heightCm: h }),
      })
      await load()
      setHeightInput("")
    } finally {
      setSavingHeight(false)
    }
  }

  const { measurements, heightCm } = data

  function sparkValues(key: MetricKey) {
    return [...measurements].reverse().slice(-10).map(m => m[key]).filter((v): v is number => v !== null)
  }

  function latestAndPrev(key: MetricKey): [number | null, number | null] {
    const vals = measurements.filter(m => m[key] !== null)
    const latest = vals[0]?.[key] ?? null
    const prev = vals[1]?.[key] ?? null
    return [latest, prev]
  }

  const inputCls = "h-9 bg-secondary/50 border-border text-sm focus:ring-primary/50"

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">📏 Body Measurements</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Track weight, measurements, and body composition over time</p>
      </div>

      {/* Height setup prompt */}
      {!heightCm && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm font-medium mb-2">Set your height to enable BMI calculation</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="e.g. 175"
                value={heightInput}
                onChange={e => setHeightInput(e.target.value)}
                className={cn(inputCls, "w-28")}
                min={50}
                max={300}
              />
              <span className="text-sm text-muted-foreground">cm</span>
              <Button size="sm" onClick={saveHeight} disabled={savingHeight || !heightInput}>
                {savingHeight ? "Saving…" : "Save height"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trend cards */}
      {measurements.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {METRICS.map(({ key, label, unit }) => {
            const [latest, prev] = latestAndPrev(key)
            if (latest === null) return null
            const sparkVals = sparkValues(key)
            const isBmi = key === "bmi"
            const bmiInfo = isBmi ? bmiLabel(latest) : null
            return (
              <Card key={key}>
                <CardContent className="pt-3 pb-3">
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className={cn("text-lg font-bold tabular-nums", isBmi && bmiInfo ? bmiInfo.color : "text-foreground")}>
                    {latest.toFixed(1)}{unit}
                  </p>
                  {isBmi && bmiInfo && (
                    <p className={cn("text-xs", bmiInfo.color)}>{bmiInfo.label}</p>
                  )}
                  <div className="flex items-center justify-between mt-1.5">
                    <DeltaBadge current={latest} prev={prev} unit={unit} />
                    <Sparkline values={sparkVals} />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Log entry form */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Log measurement</CardTitle>
            {heightCm && (
              <span className="text-xs text-muted-foreground">Height: {heightCm} cm</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Basic fields */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={inputCls} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Weight (kg)</Label>
                <Input type="number" step="0.1" placeholder="e.g. 75.4" value={form.weightKg} onChange={e => setForm(f => ({ ...f, weightKg: e.target.value }))} className={inputCls} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Waist (cm)</Label>
                <Input type="number" step="0.1" placeholder="e.g. 82" value={form.waistCm} onChange={e => setForm(f => ({ ...f, waistCm: e.target.value }))} className={inputCls} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Body Fat (%)</Label>
                <Input type="number" step="0.1" placeholder="e.g. 18.5" value={form.bodyFatPct} onChange={e => setForm(f => ({ ...f, bodyFatPct: e.target.value }))} className={inputCls} />
              </div>
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setAdvanced(a => !a)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {advanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {advanced ? "Hide" : "Show"} advanced fields
            </button>

            {advanced && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Hips (cm)</Label>
                  <Input type="number" step="0.1" placeholder="e.g. 95" value={form.hipsCm} onChange={e => setForm(f => ({ ...f, hipsCm: e.target.value }))} className={inputCls} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Chest (cm)</Label>
                  <Input type="number" step="0.1" placeholder="e.g. 100" value={form.chestCm} onChange={e => setForm(f => ({ ...f, chestCm: e.target.value }))} className={inputCls} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Neck (cm)</Label>
                  <Input type="number" step="0.1" placeholder="e.g. 38" value={form.neckCm} onChange={e => setForm(f => ({ ...f, neckCm: e.target.value }))} className={inputCls} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Muscle (%)</Label>
                  <Input type="number" step="0.1" placeholder="e.g. 42" value={form.musclePct} onChange={e => setForm(f => ({ ...f, musclePct: e.target.value }))} className={inputCls} />
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-4">
                  <Label className="text-xs">Notes</Label>
                  <Input type="text" placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving} size="sm">
                {saving ? "Saving…" : "Log entry"}
              </Button>
              {saveMsg && (
                <span className={cn("text-xs", saveMsg.includes("Error") ? "text-red-400" : "text-green-400")}>
                  {saveMsg}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* History table */}
      {measurements.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">History</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-1.5 animate-pulse">
                <div className="flex gap-4 py-2 border-b border-border/40">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-3 rounded bg-border flex-1" />
                  ))}
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-4 py-2 border-b border-border/40">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <div key={j} className="h-3 rounded bg-border/60 flex-1" />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/40">
                      <th className="text-left py-2 pr-3 font-medium">Date</th>
                      <th className="text-right py-2 px-2 font-medium">Weight</th>
                      <th className="text-right py-2 px-2 font-medium">Waist</th>
                      <th className="text-right py-2 px-2 font-medium">Hips</th>
                      <th className="text-right py-2 px-2 font-medium">Chest</th>
                      <th className="text-right py-2 px-2 font-medium">Neck</th>
                      <th className="text-right py-2 px-2 font-medium">Fat%</th>
                      <th className="text-right py-2 px-2 font-medium">Muscle%</th>
                      <th className="text-right py-2 px-2 font-medium">BMI</th>
                      <th className="py-2 pl-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {measurements.slice(0, 20).map(m => {
                      const bmiInfo = m.bmi ? bmiLabel(m.bmi) : null
                      return (
                        <tr key={m.id} className="border-b border-border/20 last:border-0 hover:bg-secondary/30 transition-colors">
                          <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{m.date}</td>
                          <td className="text-right py-2 px-2 tabular-nums">{m.weightKg != null ? `${m.weightKg.toFixed(1)} kg` : "—"}</td>
                          <td className="text-right py-2 px-2 tabular-nums">{m.waistCm != null ? `${m.waistCm}` : "—"}</td>
                          <td className="text-right py-2 px-2 tabular-nums">{m.hipsCm != null ? `${m.hipsCm}` : "—"}</td>
                          <td className="text-right py-2 px-2 tabular-nums">{m.chestCm != null ? `${m.chestCm}` : "—"}</td>
                          <td className="text-right py-2 px-2 tabular-nums">{m.neckCm != null ? `${m.neckCm}` : "—"}</td>
                          <td className="text-right py-2 px-2 tabular-nums">{m.bodyFatPct != null ? `${m.bodyFatPct}%` : "—"}</td>
                          <td className="text-right py-2 px-2 tabular-nums">{m.musclePct != null ? `${m.musclePct}%` : "—"}</td>
                          <td className={cn("text-right py-2 px-2 tabular-nums font-medium", bmiInfo?.color)}>
                            {m.bmi != null ? m.bmi.toFixed(1) : "—"}
                          </td>
                          <td className="py-2 pl-2">
                            <button
                              onClick={() => handleDelete(m.id)}
                              disabled={deleting === m.id}
                              className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && measurements.length === 0 && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
            <span className="text-4xl">📏</span>
            <p className="text-sm">No measurements yet. Log your first entry above.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
