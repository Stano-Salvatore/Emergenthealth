"use client"

import { useEffect, useState } from "react"
import { MapPin, X, Check, Loader2 } from "lucide-react"

const DISMISS_KEY = "place_detector_dismissed_until"

interface CheckIn {
  id: string
  place: string
  checkedAt: string
}

type State = "idle" | "detecting" | "prompt" | "saving" | "saved" | "dismissed"

export function PlaceDetector() {
  const [state, setState] = useState<State>("idle")
  const [detectedPlace, setDetectedPlace] = useState("")

  useEffect(() => {
    const dismissedUntil = sessionStorage.getItem(DISMISS_KEY)
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil)) return
    if (!navigator.geolocation) return

    setState("detecting")

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords

          // Check for recent check-in in last 2 hours
          const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
          const recentRes = await fetch(`/api/checkins?since=${since}&limit=1`)
          if (recentRes.ok) {
            const recent: CheckIn[] = await recentRes.json().catch(() => [])
            if (Array.isArray(recent) && recent.length > 0) { setState("dismissed"); return }
          }

          const geoRes = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`)
          if (!geoRes.ok) { setState("dismissed"); return }
          const { place } = await geoRes.json()
          setDetectedPlace(place)
          setState("prompt")
        } catch {
          setState("dismissed")
        }
      },
      () => setState("dismissed"),
      { timeout: 8000, maximumAge: 60000 }
    )
  }, [])

  async function logPlace() {
    setState("saving")
    try {
      await fetch("/api/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: detectedPlace, emoji: "📍" }),
      })
      setState("saved")
      setTimeout(() => setState("dismissed"), 2000)
    } catch {
      setState("dismissed")
    }
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, String(Date.now() + 60 * 60 * 1000))
    setState("dismissed")
  }

  if (state === "dismissed" || state === "idle" || state === "detecting") return null

  if (state === "saved") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/5 px-3 py-2.5 text-sm">
        <Check className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-green-400 font-medium">Logged: {detectedPlace}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2.5">
      <MapPin className="h-4 w-4 text-indigo-400 shrink-0" />
      <span className="text-sm flex-1 truncate">
        <span className="text-muted-foreground">You&apos;re in </span>
        <span className="font-medium">{detectedPlace}</span>
      </span>
      <button
        onClick={logPlace}
        disabled={state === "saving"}
        className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded-md hover:bg-indigo-500/10 shrink-0 disabled:opacity-50"
      >
        {state === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Log it"}
      </button>
      <button onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
