"use client"

// Food tab on the Intake page: snap a photo of a meal, Claude estimates the
// items, calories and macros, the user adjusts and saves. Manual entry works
// too for meals without a photo.

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { format } from "date-fns"
import { Camera, Loader2, Pencil, Plus, ScanLine, Sparkles, Trash2, UtensilsCrossed, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { capturePhoto, downscaleDataUrl } from "@/lib/native/camera"
import { barcodeSupported, detectBarcode } from "@/lib/barcode"
import { getCurrentPosition } from "@/lib/native/geolocation"
import { matchSavedPlace, type PlaceLike } from "@/lib/places"
import { estimateCaffeine, decayed, hoursToBedtime } from "@/lib/caffeine"

interface FoodItem {
  kind?: "food" | "drink"
  name: string
  portion: string
  grams?: number
  searchQuery?: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  sugarG?: number
  drinkType?: string
  volumeMl?: number
  source?: "db" | "est"
  dbName?: string
}

interface Micronutrient {
  name: string
  amount: number
  unit: string
  dailyPct: number
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
  micros: Micronutrient[] | null
  note: string | null
  photo: string | null
  place: string | null
  loggedAt: string
}

type MealLocation = { lat: number; lng: number; place: string | null }

/**
 * Where the meal is being logged — coordinates plus a human label. A saved
 * place wins ("Kaviareň Vták" beats "Staré Mesto, Bratislava"); otherwise
 * reverse-geocode. Best-effort throughout.
 */
async function locateMeal(): Promise<MealLocation | null> {
  const pos = await getCurrentPosition()
  if (!pos) return null
  let place: string | null = null
  try {
    const places: PlaceLike[] = await fetch("/api/saved-places").then(r => r.ok ? r.json() : [])
    const m = matchSavedPlace(pos.lat, pos.lon, places, pos.accuracy ?? 0)
    if (m) place = m.place.name
  } catch { /* fall through to geocoding */ }
  if (!place) {
    try {
      const res = await fetch(`/api/geocode?lat=${pos.lat}&lon=${pos.lon}`)
      if (res.ok) place = (await res.json()).place ?? null
    } catch { /* coords alone are still useful */ }
  }
  return { lat: pos.lat, lng: pos.lon, place }
}

interface Analysis {
  isFood: boolean
  name: string
  mealType: string
  items: FoodItem[]
  micros: Micronutrient[]
  healthNote: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  sugarG?: number
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

export function FoodTab({ date, isToday, onSaved }: { date: string; isToday: boolean; onSaved?: () => void }) {
  const [logs, setLogs] = useState<FoodLog[]>([])
  const [supplements, setSupplements] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [refining, setRefining] = useState(false)
  const [refineText, setRefineText] = useState("")
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  // Kicked off when a draft starts so the fix is usually ready by save time.
  const locRef = useRef<Promise<MealLocation | null> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/food?date=${date}`)
      if (res.ok) {
        const d = await res.json()
        setLogs(d.logs ?? [])
        setSupplements(d.supplements ?? [])
      }
    } catch { /* keep whatever is on screen */ }
    finally { setLoading(false) }
  }, [date])

  useEffect(() => { load() }, [load])

  async function snapMeal() {
    setError(null)
    const photo = await capturePhoto()
    if (!photo) return
    locRef.current = locateMeal().catch(() => null)
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
        setError("That doesn't look like food or drink — try another photo, or add it manually.")
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

  /** Re-run the analysis with a user correction and/or a nutrition-label photo. */
  async function refine(opts: { hint?: string; label?: string }) {
    if (!draft?.photo) return
    setRefining(true)
    setError(null)
    try {
      const res = await fetch("/api/food/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: draft.photo,
          hint: opts.hint,
          label: opts.label,
          previous: draft.analysis ?? undefined,
        }),
      })
      if (!res.ok) {
        setError("Re-analysis failed — your current numbers are unchanged.")
        return
      }
      const a: Analysis = await res.json()
      if (!a.isFood || a.items.length === 0) {
        setError("Re-analysis came back empty — your current numbers are unchanged.")
        return
      }
      setDraft({
        ...draft,
        analysis: a,
        name: a.name || draft.name,
        mealType: a.mealType,
        calories: String(a.calories),
        proteinG: String(a.proteinG),
        carbsG: String(a.carbsG),
        fatG: String(a.fatG),
        note: a.healthNote,
      })
      setRefineText("")
    } catch {
      setError("Re-analysis failed — your current numbers are unchanged.")
    } finally {
      setRefining(false)
    }
  }

  async function snapLabel() {
    const label = await capturePhoto()
    if (label) await refine({ hint: refineText.trim() || undefined, label })
  }

  function startManual() {
    setError(null)
    locRef.current = locateMeal().catch(() => null)
    setDraft({
      photo: null, analysis: null,
      name: "", mealType: "other",
      calories: "", proteinG: "", carbsG: "", fatG: "", note: "",
    })
  }

  /** Scan a product barcode → exact label nutrition from Open Food Facts. */
  async function scanBarcode() {
    setError(null)
    const photo = await capturePhoto()
    if (!photo) return
    setScanning(true)
    try {
      const code = await detectBarcode(photo)
      if (!code) {
        setError(barcodeSupported()
          ? "No barcode found — get closer so it fills the frame."
          : "Barcode reading isn't supported in this browser — snap the meal instead.")
        return
      }
      const res = await fetch(`/api/food/barcode?code=${code}`)
      if (!res.ok) {
        setError(res.status === 404
          ? "Product isn't in Open Food Facts — snap the label instead."
          : "Barcode lookup failed — try again.")
        return
      }
      const prod: {
        name: string; servingG: number | null
        per100: { kcal: number; proteinG: number | null; carbsG: number | null; fatG: number | null; sugarG: number | null }
      } = await res.json()
      locRef.current = locateMeal().catch(() => null)
      const grams = prod.servingG ?? 100
      const scale = (v: number | null) => v != null ? Math.round(v * grams / 10) / 10 : 0
      const kcal = Math.round(prod.per100.kcal * grams / 100)
      const analysis: Analysis = {
        isFood: true, name: prod.name, mealType: "snack",
        items: [{
          kind: "food", name: prod.name, portion: `${grams} g`, grams,
          searchQuery: "", calories: kcal,
          proteinG: scale(prod.per100.proteinG), carbsG: scale(prod.per100.carbsG),
          fatG: scale(prod.per100.fatG), sugarG: scale(prod.per100.sugarG),
          drinkType: "none", volumeMl: 0, source: "db", dbName: "Open Food Facts (label)",
        }],
        micros: [], healthNote: "",
        calories: kcal, proteinG: scale(prod.per100.proteinG),
        carbsG: scale(prod.per100.carbsG), fatG: scale(prod.per100.fatG),
        sugarG: scale(prod.per100.sugarG),
      }
      setDraft({
        photo: null,
        analysis,
        name: prod.name,
        mealType: "snack",
        calories: String(kcal),
        proteinG: String(analysis.proteinG),
        carbsG: String(analysis.carbsG),
        fatG: String(analysis.fatG),
        note: prod.servingG ? `1 serving (${grams} g) — label data` : "per 100 g — label data, adjust to your portion",
      })
    } finally {
      setScanning(false)
    }
  }

  async function saveDraft() {
    if (!draft) return
    const calories = parseInt(draft.calories)
    if (!draft.name.trim() || !Number.isFinite(calories) || calories < 0) return
    setSaving(true)
    try {
      // Store a viewable copy (~900px, ≈100–250KB) — big enough to reopen
      // full-screen from the meal list, small enough for a DB text column.
      // (Earlier saves kept only a 320px thumb, so old photos reopen blurry.)
      const thumb = draft.photo ? await downscaleDataUrl(draft.photo, 900, 0.62) : null
      // Location was requested when the draft started; give it a short grace
      // period but never hold the save hostage to a slow GPS fix.
      const loc = await Promise.race([
        locRef.current ?? Promise.resolve(null),
        new Promise<null>(r => setTimeout(() => r(null), 1500)),
      ])
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
          sugarG: draft.analysis?.sugarG,
          items: draft.analysis?.items,
          micros: draft.analysis?.micros,
          note: draft.note.trim() || undefined,
          photo: thumb ?? undefined,
          lat: loc?.lat,
          lng: loc?.lng,
          place: loc?.place ?? undefined,
        }),
      })
      if (res.ok) {
        setDraft(null)
        load()
        onSaved?.() // mirrored drinks land in Intake/Caffeine — refresh them
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
    onSaved?.() // mirrored drinks were removed too
  }

  // Inline meal editing — fix a name or a number without re-snapping
  const [editing, setEditing] = useState<{ id: string; name: string; mealType: string; calories: string; proteinG: string; carbsG: string; fatG: string } | null>(null)
  // Tap a saved meal's thumbnail to see the photo full-screen again
  const [photoView, setPhotoView] = useState<{ src: string; name: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  function startEditLog(log: FoodLog) {
    setEditing({
      id: log.id,
      name: log.name,
      mealType: log.mealType,
      calories: String(log.calories),
      proteinG: log.proteinG != null ? String(log.proteinG) : "",
      carbsG: log.carbsG != null ? String(log.carbsG) : "",
      fatG: log.fatG != null ? String(log.fatG) : "",
    })
  }

  async function saveEditLog() {
    if (!editing) return
    const calories = parseInt(editing.calories)
    if (!editing.name.trim() || !Number.isFinite(calories) || calories < 0) return
    setSavingEdit(true)
    try {
      const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : undefined }
      const res = await fetch("/api/food", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          name: editing.name.trim(),
          mealType: editing.mealType,
          calories,
          proteinG: num(editing.proteinG),
          carbsG: num(editing.carbsG),
          fatG: num(editing.fatG),
        }),
      })
      if (res.ok) {
        setEditing(null)
        load()
      }
    } finally { setSavingEdit(false) }
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

  // Vitamins & minerals across the day's meals, summed by % daily value…
  const microTotals = new Map<string, { name: string; dailyPct: number }>()
  for (const log of logs) {
    for (const m of log.micros ?? []) {
      const key = m.name.toLowerCase()
      const acc = microTotals.get(key)
      if (acc) acc.dailyPct += m.dailyPct
      else microTotals.set(key, { name: m.name, dailyPct: m.dailyPct })
    }
  }
  // …merged with supplements taken via the Oura ring (name-matched loosely,
  // e.g. Oura "Vitamin D3 + K2" covers a food-derived "Vitamin D")
  const isSupplemented = (microName: string) => {
    const n = microName.toLowerCase()
    return supplements.some(s => {
      const sl = s.toLowerCase()
      return sl.includes(n) || n.includes(sl)
    })
  }
  const microChips = [...microTotals.values()].sort((a, b) => b.dailyPct - a.dailyPct)
  const supplementOnly = supplements.filter(s => {
    const sl = s.toLowerCase()
    return ![...microTotals.values()].some(m => sl.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(sl))
  })

  // Caffeine this draft's drinks would add, and what's left of it at 23:00
  const draftCaffeineMg = draft?.analysis?.items.reduce((s, it) => {
    if (it.kind !== "drink" || !it.drinkType || !it.volumeMl) return s
    return s + (estimateCaffeine(it.drinkType, it.name, it.volumeMl)?.mg ?? 0)
  }, 0) ?? 0
  const draftCaffeineAtBed = draftCaffeineMg > 0 ? decayed(draftCaffeineMg, hoursToBedtime()) : 0

  return (
    <div className="space-y-5">
      {/* day summary */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <MacroCard label="Calories" value={`${totals.calories}`} unit="kcal" color="text-orange-400" emoji="🔥" />
        <MacroCard label="Protein" value={totals.proteinG.toFixed(0)} unit="g" color="text-rose-400" emoji="🥩" />
        <MacroCard label="Carbs" value={totals.carbsG.toFixed(0)} unit="g" color="text-amber-400" emoji="🍞" />
        <MacroCard label="Fat" value={totals.fatG.toFixed(0)} unit="g" color="text-yellow-400" emoji="🧈" />
      </div>

      {/* vitamins & minerals today — food-derived %DV plus Oura-logged supplements */}
      {(microChips.length > 0 || supplements.length > 0) && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Vitamins &amp; minerals today
          </p>
          <div className="flex flex-wrap gap-1.5">
            {microChips.map(m => (
              <span key={m.name} className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-400">
                {m.name} ≈{Math.round(m.dailyPct)}%{isSupplemented(m.name) && <span title="Also taken as a supplement (Oura)"> + 💊</span>}
              </span>
            ))}
            {supplementOnly.map(s => (
              <span key={s} title="Supplement logged via Oura"
                className="px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-400">
                💊 {s}
              </span>
            ))}
          </div>
          {supplements.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1.5">💊 = logged as a supplement in the Oura app</p>
          )}
        </div>
      )}

      {/* capture / manual entry */}
      {isToday && !draft && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={snapMeal} disabled={analyzing} className="gap-2">
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {analyzing ? "Analyzing…" : "Snap a meal or drink"}
          </Button>
          <Button variant="outline" onClick={scanBarcode} disabled={analyzing || scanning} className="gap-2">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            {scanning ? "Looking up…" : "Scan barcode"}
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
                    <span className="flex-1 min-w-0 truncate">
                      {it.kind === "drink" && <span className="mr-1" title="Also logged as a drink">🥤</span>}
                      {it.name}
                      <span className="ml-1.5 cursor-help" title={it.source === "db" ? `USDA database: ${it.dbName}` : "Estimated by Emergy"}>
                        {it.source === "db" ? "📖" : "≈"}
                      </span>
                    </span>
                    <span className="text-muted-foreground shrink-0">{it.portion}</span>
                    <span className="font-medium text-orange-400 shrink-0 w-14 text-right">{it.calories} kcal</span>
                  </div>
                ))}
              </div>
            )}
            {draft.analysis && draft.analysis.items.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                📖 = USDA database values for the estimated portion · ≈ = Emergy&apos;s estimate
              </p>
            )}
            {draft.analysis?.items.some(it => it.kind === "drink") && (
              <p className="text-[10px] text-muted-foreground">🥤 Drinks are also added to your drinks tracker (volume &amp; caffeine).</p>
            )}
            {draftCaffeineMg > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <span className="text-sm shrink-0">☕</span>
                <p className="text-[11px] text-amber-400">
                  Adds ≈{draftCaffeineMg} mg caffeine
                  {draftCaffeineAtBed > 5
                    ? <> — ≈{draftCaffeineAtBed} mg will still be active at 23:00 (5h half-life)</>
                    : <> — it&apos;ll have worn off by 23:00</>}
                </p>
              </div>
            )}

            {/* editable totals — all estimates, so nudge or type exact values */}
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
                  <span className="block text-[10px] text-muted-foreground text-center">≈ {label}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground mr-1">Adjust kcal:</span>
              {[-50, -25, +25, +50].map(d => (
                <button key={d}
                  onClick={() => setDraft({ ...draft, calories: String(Math.max(0, (parseInt(draft.calories) || 0) + d)) })}
                  className="px-2 py-0.5 rounded-md border text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
            </div>

            {/* notable vitamins & minerals */}
            {draft.analysis && draft.analysis.micros.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Vitamins &amp; minerals (est.)</p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.analysis.micros.map((m, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400">
                      {m.name} {m.dailyPct > 0 ? `${m.dailyPct}%` : `${m.amount}${m.unit}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {draft.analysis?.healthNote && (
              <p className="text-xs text-muted-foreground italic">🌱 {draft.analysis.healthNote}</p>
            )}

            {/* accuracy tools — only for photo-based drafts */}
            {draft.photo && (
              <div className="rounded-lg border border-border/60 bg-secondary/20 p-2.5 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Not quite right?</p>
                <div className="flex gap-1.5">
                  <input value={refineText}
                    onChange={e => setRefineText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && refineText.trim() && !refining && refine({ hint: refineText.trim() })}
                    placeholder="Tell Emergy what&apos;s off — oat milk, 500 ml glass, half eaten…"
                    className="flex-1 min-w-0 rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary" />
                  <Button size="sm" variant="outline" className="gap-1.5 shrink-0"
                    onClick={() => refine({ hint: refineText.trim() })}
                    disabled={refining || !refineText.trim()}>
                    {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Re-analyze
                  </Button>
                </div>
                <button onClick={snapLabel} disabled={refining}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                  <Camera className="h-3 w-3" />
                  Packaged food? Snap the nutrition label for exact values
                </button>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={saveDraft} className="gap-1.5"
                disabled={saving || refining || !draft.name.trim() || !Number.isFinite(parseInt(draft.calories))}>
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
              {isToday && <p className="text-xs text-muted-foreground mt-1">Snap a photo of a meal or drink and let Emergy figure out the rest</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {[...logs].reverse().map(log => log.id === editing?.id ? (
              <div key={log.id} className="px-3 py-3 rounded-xl border border-primary/40 bg-card space-y-2.5">
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                  className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm font-medium outline-none focus:border-primary" />
                <div className="flex flex-wrap gap-1.5">
                  {MEAL_TYPES.map(m => (
                    <button key={m.key} onClick={() => setEditing({ ...editing, mealType: m.key })}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs transition-colors",
                        editing.mealType === m.key
                          ? "border-primary bg-primary/10 text-foreground font-medium"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}>
                      <span>{m.emoji}</span>{m.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {([["calories", "kcal"], ["proteinG", "protein g"], ["carbsG", "carbs g"], ["fatG", "fat g"]] as const).map(([key, label]) => (
                    <label key={key} className="space-y-1">
                      <input type="number" inputMode="decimal" min={0} value={editing[key]}
                        onChange={e => setEditing({ ...editing, [key]: e.target.value })}
                        className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-center outline-none focus:border-primary" />
                      <span className="block text-[10px] text-muted-foreground text-center">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-1.5 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={savingEdit}>Cancel</Button>
                  <Button size="sm" onClick={saveEditLog}
                    disabled={savingEdit || !editing.name.trim() || !Number.isFinite(parseInt(editing.calories))}>
                    {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <div key={log.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-card hover:bg-secondary/30 transition-colors group">
                {log.photo ? (
                  <button onClick={() => setPhotoView({ src: log.photo!, name: log.name })}
                    aria-label={`View photo of ${log.name}`} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- stored data-URL photo */}
                    <img src={log.photo} alt="" className="w-11 h-11 rounded-lg object-cover" />
                  </button>
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-secondary flex items-center justify-center text-lg shrink-0">
                    {MEAL_EMOJI[log.mealType] ?? "🥡"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{log.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ≈{log.calories} kcal
                    {log.proteinG != null && ` · P ${Math.round(log.proteinG)}g`}
                    {log.carbsG != null && ` · C ${Math.round(log.carbsG)}g`}
                    {log.fatG != null && ` · F ${Math.round(log.fatG)}g`}
                  </p>
                  {log.micros && log.micros.length > 0 && (
                    <p className="text-[10px] text-emerald-400/80 truncate">
                      {[...log.micros].sort((a, b) => b.dailyPct - a.dailyPct).slice(0, 3)
                        .map(m => `${m.name} ${m.dailyPct}%`).join(" · ")}
                    </p>
                  )}
                  {log.place && (
                    <p className="text-[10px] text-muted-foreground/70 truncate">📍 {log.place}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {format(new Date(log.loggedAt), "HH:mm")}
                </span>
                <div className="flex items-center shrink-0">
                  <button onClick={() => startEditLog(log)}
                    aria-label={`Edit ${log.name}`}
                    className="text-muted-foreground/60 hover:text-foreground transition-colors p-1">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteEntry(log.id)}
                    aria-label={`Delete ${log.name}`}
                    className="text-muted-foreground/60 hover:text-destructive transition-colors p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {photoView && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPhotoView(null)}
          role="dialog" aria-label={`Photo of ${photoView.name}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- stored data-URL photo */}
          <img src={photoView.src} alt={photoView.name}
            className="max-w-full max-h-[85vh] rounded-xl object-contain" />
          <p className="absolute bottom-6 left-0 right-0 text-center text-sm text-white/80 px-6 truncate">
            {photoView.name}
          </p>
          <button
            onClick={() => setPhotoView(null)}
            aria-label="Close photo"
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      )}
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
