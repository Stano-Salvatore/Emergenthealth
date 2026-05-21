"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Target, Save, Loader2 } from "lucide-react"

interface Goals {
  sleepH: number
  steps: number
  waterMl: number
  focusMin: number
  habitsTarget: number
  weightKg: number | null
  readinessMin: number
  coffeeMax: number
}

const FIELDS: { key: keyof Goals; label: string; unit: string; min: number; step: number }[] = [
  { key: "sleepH",      label: "Sleep goal",        unit: "hours",    min: 4,   step: 0.5 },
  { key: "steps",       label: "Daily steps goal",   unit: "steps",    min: 1000, step: 500 },
  { key: "waterMl",     label: "Water goal",         unit: "ml",       min: 500,  step: 100 },
  { key: "focusMin",    label: "Focus goal",         unit: "min/day",  min: 15,   step: 15 },
  { key: "readinessMin",label: "Readiness min",      unit: "score",    min: 50,   step: 5 },
  { key: "coffeeMax",   label: "Coffee max",         unit: "ml/day",   min: 0,    step: 50 },
]

export function GoalsEditor() {
  const [goals, setGoals] = useState<Goals | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch("/api/goals").then(r => r.json()).then(setGoals)
  }, [])

  async function save() {
    if (!goals) return
    setSaving(true)
    await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(goals),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!goals) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Target className="h-4 w-4 text-primary" /> Personal Goals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(f => (
            <div key={f.key}>
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <div className="flex items-center gap-1.5 mt-1">
                <Input
                  type="number"
                  min={f.min}
                  step={f.step}
                  value={goals[f.key] ?? ""}
                  onChange={e => setGoals(g => g ? ({ ...g, [f.key]: parseFloat(e.target.value) || 0 }) : g)}
                  className="h-8 text-sm"
                />
                <span className="text-xs text-muted-foreground shrink-0 w-16">{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <Button onClick={save} disabled={saving} size="sm" className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saved ? "Saved!" : saving ? "Saving…" : "Save goals"}
        </Button>
      </CardContent>
    </Card>
  )
}
