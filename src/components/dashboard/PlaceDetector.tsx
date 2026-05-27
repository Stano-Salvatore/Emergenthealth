"use client"

import { useEffect, useState, useRef } from "react"
import { MapPin, X, Check, Loader2 } from "lucide-react"

const DISMISS_KEY = "place_detector_dismissed_until"

type State = "idle" | "detecting" | "saved" | "denied" | "manual" | "saving" | "dismissed"

function getInitialState(): State {
  try {
    const v = sessionStorage.getItem(DISMISS_KEY)
    if (v && Date.now() < parseInt(v)) return "dismissed"
  } catch { /* */ }
  return "idle"
}

export function PlaceDetector() {
  const [state, setState] = useState<State>(getInitialState)
  const [savedPlace, setSavedPlace] = useState("")
  const [manualInput, setManualInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state !== "idle") return
    if (!navigator?.geolocation) { setState("denied"); return }

    // Check for recent check-in (2h) — skip if already logged
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    fetch(`/api/checkins?since=${since}&limit=1`)
      .then(r => r.ok ? r.json() : [])
      .then((recent: unknown[]) => {
        if (Array.isArray(recent) && recent.length > 0) { dismiss(); return }
        setState("detecting")
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              const { latitude: lat, longitude: lon } = pos.coords
              const res = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`)
              if (!res.ok) throw new Error()
              const { place } = await res.json()
              await fetch("/api/checkins", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ place, emoji: "📍" }),
              })
              setSavedPlace(place)
              setState("saved")
              setTimeout(() => dismiss(), 3000)
            } catch {
              setState("denied")
            }
          },
          () => setState("denied"),
          { timeout: 10000, maximumAge: 120000 }
        )
      })
      .catch(() => setState("detecting"))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, String(Date.now() + 60 * 60 * 1000)) } catch { /* */ }
    setState("dismissed")
  }

  async function saveManual() {
    if (!manualInput.trim()) return
    setState("saving")
    await fetch("/api/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: manualInput.trim(), emoji: "📍" }),
    }).catch(() => {})
    setSavedPlace(manualInput.trim())
    setState("saved")
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

  if (state === "saved") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/5 px-3 py-2">
        <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
        <span className="text-xs text-green-400 font-medium flex-1">📍 Logged: {savedPlace}</span>
      </div>
    )
  }

  if (state === "denied") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/30 px-3 py-2">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {state === "denied" && (
          <input
            ref={inputRef}
            autoFocus
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && saveManual()}
            placeholder="Where are you?"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 min-w-0"
          />
        )}
        <button
          onClick={saveManual}
          disabled={!manualInput.trim() || state === "saving"}
          className="text-xs font-medium text-primary hover:text-primary/80 px-2 py-0.5 rounded hover:bg-primary/10 shrink-0 disabled:opacity-30 transition-colors"
        >
          Log
        </button>
        <button onClick={dismiss} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return null
}
