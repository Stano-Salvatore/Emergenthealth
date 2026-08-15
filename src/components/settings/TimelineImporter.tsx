"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle2, XCircle, MapPin } from "lucide-react"
import { extractVisits, matchVisitsToTargets, haversineM, type VisitTarget } from "@/lib/timeline-visits"

// The six places this matched against used to be six coordinates written into
// this file, so the import understood exactly the places someone thought to
// hardcode and nothing else — not a new home, not a place the app itself
// detected. It matches the user's saved places now, with those six kept as a
// fallback so an account that never saved them still gets its history.

const LEGACY_TARGETS: Record<string, VisitTarget> = {
  home:       { lat: 48.175421976678, lng: 17.126068557003457, label: "Home",        emoji: "🏠" },
  cafe:       { lat: 48.1490416,      lng: 17.1171726,         label: "Café",        emoji: "☕" },
  rudo_janka: { lat: 48.395534,       lng: 17.3090072,         label: "Rudo & Janka", emoji: "👨‍👩‍👧" },
  parents:    { lat: 48.3965142,      lng: 17.3227352,         label: "Parents",     emoji: "👪" },
  krstna:     { lat: 48.1594238,      lng: 17.1607528,         label: "Krstná",      emoji: "🏡" },
  zahrada:    { lat: 48.1829391,      lng: 17.3486593,         label: "Záhrada",     emoji: "🌿" },
}

const RADIUS_M = 150

interface SavedPlace {
  id: string
  name: string
  emoji: string
  lat: number
  lng: number
  radiusM: number
}

/**
 * Saved places, plus any legacy target that isn't one of them already. Merging
 * rather than replacing means an existing import keeps every series it had —
 * the correlations are keyed by these keys — while newly saved places (including
 * the ones the app detects for you) start being matched straight away.
 */
export function buildTargets(places: SavedPlace[]): Record<string, VisitTarget> {
  const targets: Record<string, VisitTarget> = {}
  for (const p of places) {
    targets[`place_${p.id}`] = { lat: p.lat, lng: p.lng, label: p.name, emoji: p.emoji || "📍" }
  }
  for (const [key, t] of Object.entries(LEGACY_TARGETS)) {
    const covered = places.some(p => haversineM(p.lat, p.lng, t.lat, t.lng) <= Math.max(p.radiusM, RADIUS_M))
    if (!covered) targets[key] = t
  }
  return targets
}

type State = "idle" | "parsing" | "uploading" | "done" | "error"

export function TimelineImporter({ hasData }: { hasData?: boolean }) {
  const [state, setState] = useState<State>("idle")
  const [result, setResult] = useState<{
    total: number
    summary: Record<string, number>
    targets: Record<string, VisitTarget>
    unmatched: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setState("parsing")
    setError(null)
    try {
      const raw = await file.text()
      let doc: unknown
      try {
        doc = JSON.parse(raw)
      } catch {
        throw new Error("Could not parse that file — make sure it's the Timeline.json from Google Maps → Timeline → Download.")
      }

      const visits = extractVisits(doc)
      if (visits.length === 0) {
        throw new Error("No visits found in that export. Expected a Timeline.json (phone export) or a Takeout Timeline file.")
      }

      const places: SavedPlace[] = await fetch("/api/saved-places")
        .then(r => (r.ok ? r.json() : []))
        .catch(() => [])
      const targets = buildTargets(Array.isArray(places) ? places : [])
      const matched = matchVisitsToTargets(visits, targets, RADIUS_M)

      const total = Object.values(matched.summary).reduce((a, b) => a + b, 0)
      if (total === 0) {
        throw new Error(
          `Found ${visits.length} visits, but none within ${RADIUS_M}m of your saved places. Save the places you care about first — the Location page can detect them for you.`,
        )
      }

      setState("uploading")
      const res = await fetch("/api/import/timeline-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visits: matched.visits, summary: matched.summary, targets }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      setResult({ total, summary: matched.summary, targets, unmatched: visits.length - total })
      setState("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
      setState("error")
    }
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
          The file is parsed locally in your browser — only visits matching your saved places are sent to the server.
        </p>

        {state === "done" && result && (
          <div className="rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2.5 space-y-1.5">
            <p className="text-xs text-green-400 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> {result.total} visits imported
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {Object.entries(result.summary)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <span key={k} className="text-[11px] text-muted-foreground">
                    {result.targets[k]?.emoji ?? "📍"} {result.targets[k]?.label ?? k}: {n}
                  </span>
                ))}
            </div>
            {result.unmatched > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {result.unmatched} more visits were somewhere you haven&apos;t saved as a place.
              </p>
            )}
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
