"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle2, XCircle, MapPin } from "lucide-react"

const TARGETS = {
  home:       { lat: 48.175421976678,  lng: 17.126068557003457 },
  cafe:       { lat: 48.1490416,        lng: 17.1171726 },
  rudo_janka: { lat: 48.395534,         lng: 17.3090072 },
  parents:    { lat: 48.3965142,        lng: 17.3227352 },
  krstna:     { lat: 48.1594238,        lng: 17.1607528 },
  zahrada:    { lat: 48.1829391,        lng: 17.3486593 },
} as const

const RADIUS_M = 150

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function parseLatLng(s: string): { lat: number; lng: number } | null {
  const m = s.match(/([\d.+-]+)°,\s*([\d.+-]+)°/)
  if (!m) return null
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
}

function parseTimeline(raw: string): { visits: Record<string, { start: string; end: string }[]>; summary: Record<string, number> } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any
  try { json = JSON.parse(raw) } catch { return null }

  const segments: unknown[] = json?.semanticSegments ?? []
  const visits: Record<string, { start: string; end: string }[]> = {
    home: [], cafe: [], rudo_janka: [], parents: [], krstna: [], zahrada: [],
  }

  for (const seg of segments) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = seg as any
    if (!s?.visit?.topCandidate?.placeLocation?.latLng) continue
    const coords = parseLatLng(s.visit.topCandidate.placeLocation.latLng)
    if (!coords) continue

    let bestKey: string | null = null
    let bestDist = Infinity
    for (const [key, target] of Object.entries(TARGETS)) {
      const d = haversineM(coords.lat, coords.lng, target.lat, target.lng)
      if (d < RADIUS_M && d < bestDist) { bestDist = d; bestKey = key }
    }
    if (!bestKey) continue

    visits[bestKey].push({ start: s.startTime, end: s.endTime })
  }

  const summary: Record<string, number> = {}
  for (const [k, v] of Object.entries(visits)) summary[k] = v.length

  return { visits, summary }
}

type State = "idle" | "parsing" | "uploading" | "done" | "error"

export function TimelineImporter({ hasData }: { hasData?: boolean }) {
  const [state, setState] = useState<State>("idle")
  const [result, setResult] = useState<{ total: number; summary: Record<string, number> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setState("parsing")
    setError(null)
    try {
      const raw = await file.text()
      const parsed = parseTimeline(raw)
      if (!parsed) throw new Error("Could not parse Timeline.json — make sure you exported from Google Maps → Timeline → Download")

      const total = Object.values(parsed.summary).reduce((a, b) => a + b, 0)
      if (total === 0) throw new Error("No matching visits found for your 6 saved locations.")

      setState("uploading")
      const res = await fetch("/api/import/timeline-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      setResult({ total, summary: parsed.summary })
      setState("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
      setState("error")
    }
  }

  const LABELS: Record<string, string> = {
    home: "🏠 Home", cafe: "☕ Café", rudo_janka: "👨‍👩‍👧 Rudo & Janka",
    parents: "👪 Parents", krstna: "🏡 Krstná", zahrada: "🌿 Záhrada",
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MapPin className="h-4 w-4 text-purple-400" />
          Google Timeline
          {hasData && state === "idle" && (
            <span className="ml-auto text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">Data loaded</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Import your Google Timeline to see how each location correlates with your health. In Google Maps → your profile → Your Timeline → ⋮ → Download data. Select <strong>Timeline.json</strong>.
        </p>
        <p className="text-xs text-muted-foreground">
          The file is parsed locally in your browser — only the matched visits (~37KB) are sent to the server.
        </p>

        {state === "done" && result && (
          <div className="rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2.5 space-y-1.5">
            <p className="text-xs text-green-400 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> {result.total} visits imported
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {Object.entries(result.summary).map(([k, n]) => (
                <span key={k} className="text-[11px] text-muted-foreground">{LABELS[k] ?? k}: {n}</span>
              ))}
            </div>
          </div>
        )}

        {state === "error" && error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {error}
          </p>
        )}

        <input
          ref={ref}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ""
          }}
        />
        <Button
          size="sm"
          variant={state === "done" ? "outline" : "default"}
          className="gap-1.5"
          disabled={state === "parsing" || state === "uploading"}
          onClick={() => ref.current?.click()}
        >
          {state === "parsing" ? (
            <><Upload className="h-3.5 w-3.5 animate-bounce" /> Parsing…</>
          ) : state === "uploading" ? (
            <><Upload className="h-3.5 w-3.5 animate-bounce" /> Uploading…</>
          ) : state === "done" ? (
            <><CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> Re-import</>
          ) : (
            <><Upload className="h-3.5 w-3.5" /> Choose Timeline.json</>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
