"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Trash2, Plus, ChevronDown, ChevronUp } from "lucide-react"
import { format } from "date-fns"

interface LabResult {
  id: string
  marker: string
  value: number
  unit: string
  referenceMin: number | null
  referenceMax: number | null
  date: string
  notes: string | null
}

const COMMON_MARKERS = [
  "Vitamin D", "TSH", "Ferritin", "HbA1c", "Cholesterol", "LDL", "HDL",
  "Triglycerides", "Glucose", "Creatinine", "ALT", "AST", "B12", "Folate",
  "Iron", "CRP",
]

const UNIT_DEFAULTS: Record<string, string> = {
  "Vitamin D": "ng/mL",
  "TSH": "mIU/L",
  "Ferritin": "ng/mL",
  "HbA1c": "%",
  "Cholesterol": "mg/dL",
  "LDL": "mg/dL",
  "HDL": "mg/dL",
  "Triglycerides": "mg/dL",
  "Glucose": "mg/dL",
  "Creatinine": "mg/dL",
  "ALT": "U/L",
  "AST": "U/L",
  "B12": "pg/mL",
  "Folate": "ng/mL",
  "Iron": "µg/dL",
  "CRP": "mg/L",
}

function statusColor(value: number, min: number | null, max: number | null) {
  if (min == null && max == null) return "text-foreground"
  const inRange =
    (min == null || value >= min) && (max == null || value <= max)
  if (inRange) {
    const nearMin = min != null && value < min + (min * 0.1)
    const nearMax = max != null && value > max - (max * 0.1)
    if (nearMin || nearMax) return "text-yellow-400"
    return "text-green-400"
  }
  return "text-red-400"
}

function Sparkline({ entries }: { entries: LabResult[] }) {
  if (entries.length < 2) return null
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  const values = sorted.map(e => e.value)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const range = maxVal - minVal || 1
  const W = 200
  const H = 40
  const pad = 4

  const points = sorted.map((e, i) => {
    const x = pad + (i / (sorted.length - 1)) * (W - pad * 2)
    const y = H - pad - ((e.value - minVal) / range) * (H - pad * 2)
    return { x, y }
  })

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")

  return (
    <svg width={W} height={H} className="opacity-70">
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" className="fill-primary" />
      ))}
    </svg>
  )
}

function MarkerCard({
  marker,
  entries,
  onDelete,
}: {
  marker: string
  entries: LabResult[]
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))
  const latest = sorted[0]
  const color = statusColor(latest.value, latest.referenceMin, latest.referenceMax)

  return (
    <Card className="bg-card/60 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-foreground">{marker}</CardTitle>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex items-end gap-3 mt-1">
          <span className={cn("text-3xl font-bold tabular-nums", color)}>
            {latest.value}
          </span>
          <span className="text-muted-foreground text-sm mb-1">{latest.unit}</span>
          {(latest.referenceMin != null || latest.referenceMax != null) && (
            <span className="text-muted-foreground text-xs mb-1">
              ref: {latest.referenceMin ?? "—"}–{latest.referenceMax ?? "—"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {format(new Date(latest.date), "MMM d, yyyy")}
          {entries.length > 1 && ` · ${entries.length} readings`}
        </p>
      </CardHeader>
      {entries.length >= 2 && (
        <CardContent className="pt-0 pb-3 px-4">
          <Sparkline entries={entries} />
        </CardContent>
      )}
      {expanded && (
        <CardContent className="pt-0 pb-3 px-4 space-y-1">
          {sorted.map(e => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 py-1.5 border-t border-border/30 text-sm"
            >
              <span className="text-muted-foreground text-xs w-24 shrink-0">
                {format(new Date(e.date), "MMM d, yyyy")}
              </span>
              <span className={cn("font-semibold tabular-nums", statusColor(e.value, e.referenceMin, e.referenceMax))}>
                {e.value} {e.unit}
              </span>
              {e.notes && <span className="text-muted-foreground text-xs flex-1 truncate">{e.notes}</span>}
              <button
                onClick={() => onDelete(e.id)}
                className="text-muted-foreground hover:text-red-400 transition-colors ml-auto shrink-0"
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

export default function LabsPage() {
  const [grouped, setGrouped] = useState<Record<string, LabResult[]>>({})
  const [loading, setLoading] = useState(true)

  const [marker, setMarker] = useState("")
  const [value, setValue] = useState("")
  const [unit, setUnit] = useState("")
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [refMin, setRefMin] = useState("")
  const [refMax, setRefMax] = useState("")
  const [notes, setNotes] = useState("")
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/labs")
      const data = await res.json()
      setGrouped(data && typeof data === "object" && !Array.isArray(data) ? data : {})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleMarkerChange(v: string) {
    setMarker(v)
    if (UNIT_DEFAULTS[v]) setUnit(UNIT_DEFAULTS[v])
    if (v.length > 0) {
      setSuggestions(COMMON_MARKERS.filter(m => m.toLowerCase().includes(v.toLowerCase()) && m !== v))
    } else {
      setSuggestions([])
    }
  }

  function pickSuggestion(m: string) {
    setMarker(m)
    setUnit(UNIT_DEFAULTS[m] ?? "")
    setSuggestions([])
  }

  async function handleAdd() {
    const numVal = parseFloat(value)
    if (!marker || isNaN(numVal) || !unit || !date) return
    setSaving(true)
    try {
      const res = await fetch("/api/labs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marker,
          value: numVal,
          unit,
          date,
          referenceMin: refMin !== "" ? parseFloat(refMin) : undefined,
          referenceMax: refMax !== "" ? parseFloat(refMax) : undefined,
          notes: notes || undefined,
        }),
      })
      if (res.ok) {
        setMarker("")
        setValue("")
        setUnit("")
        setRefMin("")
        setRefMax("")
        setNotes("")
        setSuggestions([])
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await fetch("/api/labs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    await load()
  }

  const markerList = Object.keys(grouped)

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Lab Results</h1>
        <p className="text-muted-foreground text-sm mt-1">Track your blood work and biomarkers over time.</p>
      </div>

      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Result
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Input
              placeholder="Marker name (e.g. Vitamin D)"
              value={marker}
              onChange={e => handleMarkerChange(e.target.value)}
              className="bg-background/50"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                {suggestions.slice(0, 6).map(s => (
                  <li key={s}>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors text-foreground"
                      onClick={() => pickSuggestion(s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input
              placeholder="Value"
              type="number"
              value={value}
              onChange={e => setValue(e.target.value)}
              className="bg-background/50"
            />
            <Input
              placeholder="Unit"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              className="bg-background/50"
            />
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-background/50"
            />
            <Input
              placeholder="Notes (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="bg-background/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder="Ref min (optional)"
              type="number"
              value={refMin}
              onChange={e => setRefMin(e.target.value)}
              className="bg-background/50"
            />
            <Input
              placeholder="Ref max (optional)"
              type="number"
              value={refMax}
              onChange={e => setRefMax(e.target.value)}
              className="bg-background/50"
            />
          </div>

          <Button
            onClick={handleAdd}
            disabled={saving || !marker || !value || !unit || !date}
            className="w-full"
          >
            {saving ? "Saving…" : "Add Result"}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="h-4 rounded bg-border w-32" />
              <div className="h-10 rounded bg-border/60 w-full" />
              <div className="h-3 rounded bg-border w-24" />
            </div>
          ))}
        </div>
      ) : markerList.length === 0 ? (
        <p className="text-muted-foreground text-sm">No lab results yet. Add your first result above.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markerList.map(m => (
            <MarkerCard
              key={m}
              marker={m}
              entries={grouped[m]}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
