"use client"

import { useEffect, useState } from "react"
import { MapPin, LocateFixed, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface Coords { lat: number; lon: number; label?: string }

export function WeatherLocation() {
  const [saved, setSaved]     = useState<Coords | null>(null)
  const [status, setStatus]   = useState<"idle"|"detecting"|"saving"|"saved"|"error">("idle")
  const [msg, setMsg]         = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/preferences/location")
      .then(r => r.json())
      .then(d => { if (d.lat) setSaved({ lat: d.lat, lon: d.lon, label: d.label }) })
      .catch(() => {})
  }, [])

  async function detect() {
    if (!navigator.geolocation) { setMsg("Geolocation not supported in this browser"); return }
    setStatus("detecting")
    setMsg(null)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lon } = pos.coords
        // Reverse-geocode with Nominatim
        let label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
          const d = await r.json()
          label = d.address?.city ?? d.address?.town ?? d.address?.village ?? d.name ?? label
          if (d.address?.country) label += `, ${d.address.country}`
        } catch {}
        await save({ lat, lon, label })
      },
      err => { setStatus("error"); setMsg(`Could not detect: ${err.message}`) },
      { timeout: 10000 }
    )
  }

  async function save(coords: Coords) {
    setStatus("saving")
    const res = await fetch("/api/preferences/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coords),
    })
    if (res.ok) {
      setSaved(coords)
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setMsg("Failed to save location")
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm font-medium">Weather Location</p>
        </div>

        {saved ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
            <div className="flex items-center gap-2">
              <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-green-400">{saved.label ?? "Custom location"}</p>
                <p className="text-[10px] text-muted-foreground">{saved.lat.toFixed(4)}, {saved.lon.toFixed(4)}</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={detect}
              disabled={status === "detecting" || status === "saving"}>
              Update
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Weather in Today, Garden and Emergy is currently using a default location. Set yours to get accurate forecasts.
          </p>
        )}

        <Button size="sm" variant="outline" onClick={detect}
          disabled={status === "detecting" || status === "saving"}
          className="gap-2 w-full">
          {status === "detecting" || status === "saving"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <LocateFixed className="h-3.5 w-3.5" />}
          {status === "detecting" ? "Detecting…" : status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Auto-detect my location"}
        </Button>

        {msg && <p className="text-xs text-red-400">{msg}</p>}
      </CardContent>
    </Card>
  )
}
