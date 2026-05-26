"use client"

import { useState, useRef } from "react"
import { MapPin, X, Check, Loader2, Pencil } from "lucide-react"

const DISMISS_KEY = "place_detector_dismissed_until"

type State = "ready" | "detecting" | "confirm" | "manual" | "saving" | "saved" | "dismissed"

function isDismissed() {
  try {
    const v = sessionStorage.getItem(DISMISS_KEY)
    return !!v && Date.now() < parseInt(v)
  } catch { return false }
}

export function PlaceDetector() {
  const [state, setState] = useState<State>(() => isDismissed() ? "dismissed" : "ready")
  const [place, setPlace] = useState("")
  const [manualInput, setManualInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function detect() {
    if (!navigator.geolocation) { openManual(); return }

    // Check for recent check-in (2h)
    try {
      const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const r = await fetch(`/api/checkins?since=${since}&limit=1`)
      if (r.ok) {
        const recent = await r.json().catch(() => [])
        if (Array.isArray(recent) && recent.length > 0) { dismiss(); return }
      }
    } catch { /* continue */ }

    setState("detecting")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords
          const res = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`)
          if (!res.ok) throw new Error("geocode failed")
          const { place: p } = await res.json()
          setPlace(p)
          setManualInput(p)
          setState("confirm")
        } catch {
          openManual()
        }
      },
      () => openManual(),
      { timeout: 10000, maximumAge: 120000 }
    )
  }

  function openManual() {
    setState("manual")
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function save(p: string) {
    if (!p.trim()) return
    setState("saving")
    try {
      await fetch("/api/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: p.trim(), emoji: "📍" }),
      })
      setPlace(p.trim())
      setState("saved")
      setTimeout(() => dismiss(), 2500)
    } catch {
      setState("confirm")
    }
  }

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, String(Date.now() + 60 * 60 * 1000)) } catch { /* */ }
    setState("dismissed")
  }

  if (state === "dismissed") return null

  if (state === "saved") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/5 px-3 py-2">
        <Check className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-sm text-green-400 font-medium flex-1">Logged: {place}</span>
      </div>
    )
  }

  if (state === "ready") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card/40 px-3 py-2">
        <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground flex-1">Log where you are</span>
        <button
          onClick={detect}
          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded-md hover:bg-primary/10 shrink-0"
        >
          Detect
        </button>
        <button
          onClick={openManual}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded-md hover:bg-secondary/60 shrink-0"
        >
          Type
        </button>
        <button onClick={dismiss} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1 shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  if (state === "detecting") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2">
        <Loader2 className="h-4 w-4 text-indigo-400 animate-spin shrink-0" />
        <span className="text-sm text-muted-foreground flex-1">Detecting your location…</span>
        <button onClick={() => setState("ready")} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1 shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  if (state === "confirm") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2">
        <MapPin className="h-4 w-4 text-indigo-400 shrink-0" />
        <span className="text-sm flex-1 truncate">
          <span className="text-muted-foreground">You&apos;re in </span>
          <span className="font-medium">{place}</span>
        </span>
        <button
          onClick={() => save(place)}
          className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded-md hover:bg-indigo-500/10 shrink-0"
        >
          {state === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Log it"}
        </button>
        <button onClick={openManual} className="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0" title="Edit name">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={dismiss} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1 shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  if (state === "manual") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2">
        <MapPin className="h-4 w-4 text-indigo-400 shrink-0" />
        <input
          ref={inputRef}
          value={manualInput}
          onChange={e => setManualInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && save(manualInput)}
          placeholder="Where are you? (e.g. Bratislava)"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 min-w-0"
        />
        <button
          onClick={() => save(manualInput)}
          disabled={!manualInput.trim()}
          className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded-md hover:bg-indigo-500/10 shrink-0 disabled:opacity-40"
        >
          Log
        </button>
        <button onClick={dismiss} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1 shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return null
}
