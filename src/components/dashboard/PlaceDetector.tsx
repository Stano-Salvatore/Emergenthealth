"use client"

// Place awareness for lazy logging. On the dashboard, once per hour:
//  · at a SAVED place ("Kaviareň Vták") → auto check-in under its real name,
//    and offer the usual order as a one-tap log (or a one-time usual setup)
//  · somewhere new → auto check-in with the reverse-geocoded area, plus a
//    ⭐ Save button that turns the spot into a saved place for next time
// The check-in itself never needs a tap — being there is enough.

import { useEffect, useState, useRef } from "react"
import { MapPin, X, Check, Loader2, Star } from "lucide-react"
import { getCurrentPosition } from "@/lib/native/geolocation"
import { matchSavedPlace, type PlaceLike } from "@/lib/places"

const DISMISS_KEY = "place_detector_dismissed_until"

type SavedPlace = PlaceLike & { usualType: string | null; usualMl: number | null; usualNote: string | null }

type State =
  | "idle" | "detecting" | "dismissed" | "denied" | "manual-saving"
  | "at-place"        // at a saved place (auto checked-in); may offer the usual
  | "somewhere"       // generic check-in done; may offer to save the place
  | "logged"          // one-tap usual logged
  | "saved-place"     // new place saved

// Presets for the one-time "set your usual" picker
const USUAL_PRESETS: { label: string; type: string; ml: number; note?: string; emoji: string }[] = [
  { label: "Espresso",   type: "coffee", ml: 30,  note: "Espresso",   emoji: "☕" },
  { label: "Flat white", type: "coffee", ml: 160, note: "Flat white", emoji: "☕" },
  { label: "Latte",      type: "coffee", ml: 300, note: "Latte",      emoji: "☕" },
  { label: "Batch brew", type: "coffee", ml: 250, note: "Batch brew", emoji: "🫖" },
  { label: "Tea",        type: "tea",    ml: 250,                     emoji: "🍵" },
  { label: "Matcha",     type: "matcha", ml: 250,                     emoji: "🍃" },
  { label: "Beer",       type: "beer",   ml: 500,                     emoji: "🍺" },
  { label: "Water",      type: "water",  ml: 500,                     emoji: "💧" },
]

function getInitialState(): State {
  try {
    const v = sessionStorage.getItem(DISMISS_KEY)
    if (v && Date.now() < parseInt(v)) return "dismissed"
  } catch { /* */ }
  return "idle"
}

export function PlaceDetector() {
  const [state, setState] = useState<State>(getInitialState)
  const [atPlace, setAtPlace] = useState<SavedPlace | null>(null)
  const [genericPlace, setGenericPlace] = useState("")
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [manualInput, setManualInput] = useState("")
  const [savePlaceName, setSavePlaceName] = useState("")
  const [showSavePlace, setShowSavePlace] = useState(false)
  const [showUsualPicker, setShowUsualPicker] = useState(false)
  const [loggedText, setLoggedText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state !== "idle") return
    if (!navigator?.geolocation) { setState("denied"); return }

    // Skip if a check-in already happened in the last 2h
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    fetch(`/api/checkins?since=${since}&limit=1`)
      .then(r => r.ok ? r.json() : [])
      .then(async (recent: unknown[]) => {
        if (Array.isArray(recent) && recent.length > 0) { dismiss(); return }
        setState("detecting")
        const [pos, placesRes] = await Promise.all([
          getCurrentPosition(),
          fetch("/api/saved-places").then(r => r.ok ? r.json() : []).catch(() => []),
        ])
        if (!pos) { setState("denied"); return }
        setCoords({ lat: pos.lat, lon: pos.lon })

        // Familiar ground first: a saved place beats a generic area name
        const match = matchSavedPlace(pos.lat, pos.lon, placesRes as SavedPlace[], pos.accuracy ?? 0)
        if (match) {
          await fetch("/api/checkins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ place: match.place.name, emoji: match.place.emoji, savedPlaceId: match.place.id, isAuto: true }),
          }).catch(() => {})
          setAtPlace(match.place)
          setState("at-place")
          // no usual to offer → just confirm and fade out
          if (!match.place.usualType) return
          return
        }

        // Somewhere new — generic auto check-in, offer to save the spot
        try {
          const res = await fetch(`/api/geocode?lat=${pos.lat}&lon=${pos.lon}`)
          if (!res.ok) throw new Error()
          const { place } = await res.json()
          await fetch("/api/checkins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ place, emoji: "📍", isAuto: true }),
          })
          setGenericPlace(place)
          setSavePlaceName("")
          setState("somewhere")
        } catch {
          setState("denied")
        }
      })
      .catch(() => setState("detecting"))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, String(Date.now() + 60 * 60 * 1000)) } catch { /* */ }
    setState("dismissed")
  }

  async function logUsual(place: SavedPlace) {
    if (!place.usualType || !place.usualMl) return
    setBusy(true)
    try {
      await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: place.usualType, amountMl: place.usualMl, ...(place.usualNote ? { note: place.usualNote } : {}) }),
      })
      setLoggedText(`${place.usualNote ?? place.usualType} ${place.usualMl} ml @ ${place.name}`)
      setState("logged")
      setTimeout(() => dismiss(), 3500)
    } finally { setBusy(false) }
  }

  async function setUsual(place: SavedPlace, preset: typeof USUAL_PRESETS[number]) {
    setBusy(true)
    try {
      const res = await fetch("/api/saved-places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: place.id, usualType: preset.type, usualMl: preset.ml, usualNote: preset.note ?? null }),
      })
      const updated: SavedPlace = res.ok ? await res.json() : { ...place, usualType: preset.type, usualMl: preset.ml, usualNote: preset.note ?? null }
      setAtPlace(updated)
      setShowUsualPicker(false)
      await logUsual(updated) // setting the usual means they're having it now
    } finally { setBusy(false) }
  }

  async function saveThisPlace() {
    if (!coords || !savePlaceName.trim()) return
    setBusy(true)
    try {
      const res = await fetch("/api/saved-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: savePlaceName.trim(), emoji: "⭐", lat: coords.lat, lng: coords.lon, radiusM: 75, address: genericPlace }),
      })
      if (res.ok) {
        const place: SavedPlace = await res.json()
        setAtPlace(place)
        setShowSavePlace(false)
        setShowUsualPicker(true) // straight into "and what's your usual here?"
        setState("at-place")
      }
    } finally { setBusy(false) }
  }

  async function saveManual() {
    if (!manualInput.trim()) return
    setState("manual-saving")
    await fetch("/api/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: manualInput.trim(), emoji: "📍" }),
    }).catch(() => {})
    setLoggedText(manualInput.trim())
    setState("logged")
    setTimeout(() => dismiss(), 3000)
  }

  if (state === "dismissed" || state === "idle") return null

  if (state === "detecting") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/30 px-3 py-2">
        <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
        <span className="text-xs text-muted-foreground flex-1">Detecting your location…</span>
      </div>
    )
  }

  if (state === "logged") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/5 px-3 py-2">
        <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
        <span className="text-xs text-green-400 font-medium flex-1">Logged: {loggedText}</span>
      </div>
    )
  }

  // At a saved place — checked in already; offer the usual (or set one)
  if (state === "at-place" && atPlace) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm shrink-0">{atPlace.emoji}</span>
          <span className="text-xs flex-1">
            You&apos;re at <span className="font-semibold">{atPlace.name}</span> — checked in ✓
          </span>
          <button onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground/40 hover:text-muted-foreground p-1 shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {atPlace.usualType && atPlace.usualMl ? (
          <button onClick={() => logUsual(atPlace)} disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary/15 border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 transition-colors disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>☕ Log your usual — {atPlace.usualNote ?? atPlace.usualType} {atPlace.usualMl} ml</>}
          </button>
        ) : showUsualPicker ? (
          <div className="flex flex-wrap gap-1.5">
            {USUAL_PRESETS.map(p => (
              <button key={p.label} onClick={() => setUsual(atPlace, p)} disabled={busy}
                className="flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-50">
                <span>{p.emoji}</span>{p.label}
              </button>
            ))}
          </div>
        ) : (
          <button onClick={() => setShowUsualPicker(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            Set your usual here → one tap next time
          </button>
        )}
      </div>
    )
  }

  // Somewhere unfamiliar — checked in generically; offer to remember the spot
  if (state === "somewhere") {
    return (
      <div className="rounded-xl border border-border/40 bg-card/30 px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
          <span className="text-xs text-muted-foreground flex-1">📍 Logged: {genericPlace}</span>
          {!showSavePlace && (
            <button onClick={() => { setShowSavePlace(true); setTimeout(() => inputRef.current?.focus(), 50) }}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <Star className="h-3 w-3" /> Save place
            </button>
          )}
          <button onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground/40 hover:text-muted-foreground p-1 shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {showSavePlace && (
          <div className="flex items-center gap-1.5">
            <input ref={inputRef} value={savePlaceName}
              onChange={e => setSavePlaceName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveThisPlace()}
              placeholder="Name it — e.g. Kaviareň Vták"
              className="flex-1 min-w-0 rounded-lg border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary" />
            <button onClick={saveThisPlace} disabled={busy || !savePlaceName.trim()}
              className="text-xs font-medium text-primary hover:text-primary/80 px-2 py-1 rounded hover:bg-primary/10 shrink-0 disabled:opacity-30 transition-colors">
              {busy ? "…" : "Save"}
            </button>
          </div>
        )}
      </div>
    )
  }

  if (state === "denied" || state === "manual-saving") {
    const isSaving = state === "manual-saving"
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/30 px-3 py-2">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          autoFocus={!isSaving}
          value={manualInput}
          onChange={e => setManualInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && saveManual()}
          placeholder="Where are you?"
          disabled={isSaving}
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 min-w-0 disabled:opacity-50"
        />
        <button
          onClick={saveManual}
          disabled={!manualInput.trim() || isSaving}
          className="text-xs font-medium text-primary hover:text-primary/80 px-2 py-0.5 rounded hover:bg-primary/10 shrink-0 disabled:opacity-30 transition-colors"
        >
          {isSaving ? "…" : "Log"}
        </button>
        <button onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return null
}
