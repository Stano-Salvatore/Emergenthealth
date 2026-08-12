"use client"

// Food tab on the Intake page: snap a photo of a meal, Claude estimates the
// items, calories and macros, the user adjusts and saves. Manual entry works
// too for meals without a photo.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { format } from "date-fns"
import { Camera, Loader2, Pencil, Plus, Trash2, UtensilsCrossed, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { capturePhoto, downscaleDataUrl } from "@/lib/native/camera"

interface FoodItem {
  name: string
  portion: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

interface FoodLog {
  id: string
  name: string
  mealType: string
  calories: number
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  items: FoodItem[] | null
  note: string | null
  photo: string | null
  loggedAt: string
}

interface Analysis {
  isFood: boolean
  name: string
  mealType: string
  items: FoodItem[]
  healthNote: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

const MEAL_TYPES = [
  { key: "breakfast", label: "Breakfast", emoji: "🍳" },
  { key: "lunch",     label: "Lunch",     emoji: "🥗" },
  { key: "dinner",    label: "Dinner",    emoji: "🍽️" },
  { key: "snack",     label: "Snack",     emoji: "🍎" },
  { key: "other",     label: "Other",     emoji: "🥡" },
] as const

const MEAL_EMOJI: Record<string, string> = Object.fromEntries(MEAL_TYPES.map(m => [m.key, m.emoji]))

type Draft = {
  photo: string | null      // full-size capture (sent to analysis, not stored)
  analysis: Analysis | null // null while analyzing or for manual entry
  name: string
  mealType: string
  calories: string          // editable, so keep as strings
  proteinG: string
  carbsG: string
  fatG: string
  note: string
}

export function FoodTab({ date, isToday }: { date: string; isToday: boolean }) {
  const [logs, setLogs] = useState<FoodLog[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/food?date=${date}`)
      if (res.ok) setLogs(await res.json())
    } catch { /* keep whatever is on screen */ }
    finally { setLoading(false) }
  }, [date])

  useEffect(() => { load() }, [load])

  async function snapMeal() {
    setError(null)
    const photo = await capturePhoto()
    if (!photo) return
    setAnalyzing(true)
    setDraft(null)
    try {
      const res = await fetch("/api/food/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: photo }),
      })
      if (!res.ok) {
        setError(res.status === 422 ? "Couldn't read that photo — try a clearer shot." : "Analysis failed — try again.")
        return
      }
      const a: Analysis = await res.json()
      if (!a.isFood || a.items.length === 0) {
        setError("That doesn't look like food — try another photo, or add the meal manually.")
        return
      }
      setDraft({
        photo,
        analysis: a,
        name: a.name,
        mealType: a.mealType,
        calories: String(a.calories),
        proteinG: String(a.proteinG),
        carbsG: String(a.carbsG),
        fatG: String(a.fatG),
        note: a.healthNote,
      })
    } catch {
      setError("Analysis failed — try again.")
    } finally {
      setAnalyzing(false)
    }
  }

  function startManual() {
    setError(null)
    setDraft({
      photo: null, analysis: null,
      name: "", mealType: "other",
      calories: "", proteinG: "", carbsG: "", fatG: "", note: "",
    })
  }

  async function saveDraft() {
    if (!draft) return
    const calories = parseInt(draft.calories)
    if (!draft.name.trim() || !Number.isFinite(calories) || calories < 0) return
    setSaving(true)
    try {
      // Store only a small thumbnail — the full capture stays on the device.
      const thumb = draft.photo ? await downscaleDataUrl(draft.photo, 320, 0.55) : null
      const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : undefined }
      const res = await fetch("/api/food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          mealType: draft.mealType,
          calories,
          proteinG: num(draft.proteinG),
          carbsG: num(draft.carbsG),
          fatG: num(draft.fatG),
          items: draft.analysis?.items,
          note: draft.note.trim() || undefined,
          photo: thumb ?? undefined,
        }),
      })
      if (res.ok) {
        setDraft(null)
        load()
      } else {
        setError("Couldn't save — try again.")
      }
    } finally {
      setSaving(false)
    }
  }

  async function deleteEntry(id: string) {
    await fetch("/api/food", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    load()
  }

  // day totals
  const totals = logs.reduce(
    (acc, l) => ({
      calories: acc.calories + l.calories,
      proteinG: acc.proteinG + (l.proteinG ?? 0),
      carbsG: acc.carbsG + (l.carbsG ?? 0),
      fatG: acc.fatG + (l.fatG ?? 0),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )

  return (
    <div className="space-y-5">
      {/* day summary */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <MacroCard label="Calories" value={`${totals.calories}`} unit="kcal" color="text-orange-400" emoji="🔥" />
        <MacroCard label="Protein" value={totals.proteinG.toFixed(0)} unit="g" color="text-rose-400" emoji="🥩" />
        <MacroCard label="Carbs" value={totals.carbsG.toFixed(0)} unit="g" color="text-amber-400" emoji="🍞" />
        <MacroCard label="Fat" value={totals.fatG.toFixed(0)} unit="g" color="text-yellow-400" emoji="🧈" />
      </div>

      {/* capture / manual entry */}
      {isToday && !draft && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={snapMeal} disabled={analyzing} className="gap-2">
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {analyzing ? "Analyzing your meal…" : "Snap a meal"}
          </Button>
          <Button variant="outline" onClick={startManual} disabled={analyzing} className="gap-2">
            <Pencil className="h-4 w-4" /> Add manually
          </Button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
          <span className="text-base shrink-0">📷</span>
          <p className="flex-1 text-xs text-amber-400">{error}</p>
          <button onClick={() => setError(null)} aria-label="Dismiss"
            className="p-1 rounded-md text-amber-400/60 hover:text-amber-400 transition-colors shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* draft: review the analysis (or fill in manually), then save */}
      {draft && (
        <Card className="border-primary/30">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-start gap-3">
              {draft.photo && (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
                <img src={draft.photo} alt="Your meal" className="w-20 h-20 rounded-lg object-cover shrink-0" />
              )}
              <div className="flex-1 min-w-0 space-y-2">
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Meal name"
                  className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm font-medium outline-none focus:border-primary" />
                <div className="flex flex-wrap gap-1.5">
                  {MEAL_TYPES.map(m => (
                    <button key={m.key} onClick={() => setDraft({ ...draft, mealType: m.key })}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs transition-colors",
                        draft.mealType === m.key
                          ? "border-primary bg-primary/10 text-foreground font-medium"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}>
                      <span>{m.emoji}</span>{m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* identified items */}
            {draft.analysis && draft.analysis.items.length > 0 && (
              <div className="rounded-lg border bg-secondary/30 divide-y divide-border/50">
                {draft.analysis.items.map((it, i) => (
                  <div key={i} className="flex items-baseline gap-2 px-3 py-1.5 text-xs">
                    <span className="flex-1 min-w-0 truncate">{it.name}</span>
                    <span className="text-muted-foreground shrink-0">{it.portion}</span>
                    <span className="font-medium text-orange-400 shrink-0 w-14 text-right">{it.calories} kcal</span>
                  </div>
                ))}
              </div>
            )}

            {/* editable totals */}
            <div className="grid grid-cols-4 gap-2">
              {([
                ["calories", "kcal", draft.calories],
                ["proteinG", "protein g", draft.proteinG],
                ["carbsG", "carbs g", draft.carbsG],
                ["fatG", "fat g", draft.fatG],
              ] as const).map(([key, label, value]) => (
                <label key={key} className="space-y-1">
                  <input type="number" inputMode="decimal" min={0} value={value}
                    onChange={e => setDraft({ ...draft, [key]: e.target.value })}
                    className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-center outline-none focus:border-primary" />
                  <span className="block text-[10px] text-muted-foreground text-center">{label}</span>
                </label>
              ))}
            </div>

            {draft.analysis?.healthNote && (
              <p className="text-xs text-muted-foreground italic">🌱 {draft.analysis.healthNote}</p>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={saveDraft} className="gap-1.5"
                disabled={saving || !draft.name.trim() || !Number.isFinite(parseInt(draft.calories))}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Log meal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* meal list */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {logs.length} {logs.length === 1 ? "meal" : "meals"}
        </p>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center">
              <UtensilsCrossed className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No meals logged {isToday ? "today" : "this day"}</p>
              {isToday && <p className="text-xs text-muted-foreground mt-1">Snap a photo and let Emergy figure out the rest</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {[...logs].reverse().map(log => (
              <div key={log.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-card hover:bg-secondary/30 transition-colors group">
                {log.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- stored data-URL thumbnail
                  <img src={log.photo} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-secondary flex items-center justify-center text-lg shrink-0">
                    {MEAL_EMOJI[log.mealType] ?? "🥡"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{log.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {log.calories} kcal
                    {log.proteinG != null && ` · P ${Math.round(log.proteinG)}g`}
                    {log.carbsG != null && ` · C ${Math.round(log.carbsG)}g`}
                    {log.fatG != null && ` · F ${Math.round(log.fatG)}g`}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {format(new Date(log.loggedAt), "HH:mm")}
                </span>
                <button onClick={() => deleteEntry(log.id)}
                  aria-label={`Delete ${log.name}`}
                  className="text-muted-foreground/60 hover:text-destructive transition-colors p-1 shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MacroCard({ label, value, unit, color, emoji }: {
  label: string; value: string; unit: string; color: string; emoji: string
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 text-center">
        <p className="text-2xl mb-0.5">{emoji}</p>
        <p className={`text-xl font-black ${color}`}>{value}<span className="text-xs font-medium text-muted-foreground ml-1">{unit}</span></p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  )
}
