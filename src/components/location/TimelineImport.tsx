"use client"

import { useRef, useState } from "react"
import { Upload, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

// Import a Google Takeout of Timeline / Location History.
//
// The file is parsed entirely in the browser: takeout JSONs routinely exceed
// the server's request-body limit (this repo's own sample is 12 MB, old
// Records.json exports reach hundreds), and the server only ever needs the
// few fields per point. The extracted points are uploaded in slices to
// /api/import/timeline, which is idempotent — re-importing the same file is
// a no-op, not a duplicate year of GPS data.
//
// Three shapes are recognised:
//  - "Timeline Edits.json" (current Takeout): timelineEdits[].rawSignal
//  - "Records.json" (classic Location History): locations[]
//  - "Timeline.json" (on-device phone export): semanticSegments[].timelinePath

interface ParsedPoint {
  lat: number
  lng: number
  trackedAt: string
  accuracyM?: number | null
  altitudeM?: number | null
  speedKmh?: number | null
}

const BATCH = 500

function parseLatLngString(s: unknown): { lat: number; lng: number } | null {
  // "48.1234567°, 17.1234567°" — the phone export's coordinate encoding.
  if (typeof s !== "string") return null
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function extractPoints(doc: any): ParsedPoint[] {
  const out: ParsedPoint[] = []

  if (Array.isArray(doc?.timelineEdits)) {
    for (const e of doc.timelineEdits) {
      const p = e?.rawSignal?.signal?.position
      if (!p?.point || !p.timestamp) continue
      const lat = Number(p.point.latE7) / 1e7
      const lng = Number(p.point.lngE7) / 1e7
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      out.push({
        lat, lng,
        trackedAt: p.timestamp,
        accuracyM: Number.isFinite(Number(p.accuracyMm)) ? Number(p.accuracyMm) / 1000 : null,
        altitudeM: Number.isFinite(Number(p.altitudeMeters)) ? Number(p.altitudeMeters) : null,
        speedKmh: Number.isFinite(Number(p.speedMetersPerSecond)) ? Number(p.speedMetersPerSecond) * 3.6 : null,
      })
    }
  }

  if (Array.isArray(doc?.locations)) {
    for (const l of doc.locations) {
      const lat = Number(l.latitudeE7) / 1e7
      const lng = Number(l.longitudeE7) / 1e7
      const ts = l.timestamp ?? (l.timestampMs ? new Date(Number(l.timestampMs)).toISOString() : null)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !ts) continue
      out.push({
        lat, lng,
        trackedAt: ts,
        accuracyM: Number.isFinite(Number(l.accuracy)) ? Number(l.accuracy) : null,
        altitudeM: Number.isFinite(Number(l.altitude)) ? Number(l.altitude) : null,
        speedKmh: null,
      })
    }
  }

  if (Array.isArray(doc?.semanticSegments)) {
    for (const seg of doc.semanticSegments) {
      if (!Array.isArray(seg?.timelinePath)) continue
      for (const tp of seg.timelinePath) {
        const ll = parseLatLngString(tp?.point)
        if (!ll) continue
        let ts: string | null = typeof tp?.time === "string" ? tp.time : null
        if (!ts && seg.startTime && tp?.durationMinutesOffsetFromStartTime != null) {
          const t = Date.parse(seg.startTime) + Number(tp.durationMinutesOffsetFromStartTime) * 60_000
          if (Number.isFinite(t)) ts = new Date(t).toISOString()
        }
        if (!ts) continue
        out.push({ lat: ll.lat, lng: ll.lng, trackedAt: ts })
      }
    }
  }

  // One row per (time, place): takeouts repeat points across sections, and
  // the server dedupes on the same key — trimming here saves the upload.
  const seen = new Set<string>()
  const unique = out.filter(p => {
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return false
    const t = Date.parse(p.trackedAt)
    if (!Number.isFinite(t)) return false
    const key = `${t}_${Math.round(p.lat * 1e7)}_${Math.round(p.lng * 1e7)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => Date.parse(a.trackedAt) - Date.parse(b.trackedAt))
  return unique
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type Phase =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "uploading"; done: number; total: number }
  | { kind: "done"; imported: number; total: number; from: string; to: string }
  | { kind: "error"; message: string }

export function TimelineImport({ onImported }: { onImported?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setPhase({ kind: "parsing" })
    try {
      const text = await file.text()
      let doc: unknown
      try {
        doc = JSON.parse(text)
      } catch {
        throw new Error("That file isn't JSON. Pick \"Timeline Edits.json\" from inside the Takeout zip (Takeout → Timeline).")
      }

      const points = extractPoints(doc)
      if (points.length === 0) {
        throw new Error("No GPS points found in this file. Expected a Google Timeline export — \"Timeline Edits.json\", \"Records.json\", or a phone \"Timeline.json\".")
      }

      let imported = 0
      for (let i = 0; i < points.length; i += BATCH) {
        setPhase({ kind: "uploading", done: i, total: points.length })
        const res = await fetch("/api/import/timeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: points.slice(i, i + BATCH) }),
        })
        if (!res.ok) throw new Error(`Upload failed at point ${i} (HTTP ${res.status}) — try again; already-uploaded points won't duplicate.`)
        const data = await res.json()
        imported += data.inserted ?? 0
      }

      setPhase({
        kind: "done",
        imported,
        total: points.length,
        from: points[0].trackedAt.slice(0, 10),
        to: points[points.length - 1].trackedAt.slice(0, 10),
      })
      onImported?.()
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Import failed" })
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5 text-primary" /> Import Google Timeline
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            From a Google Takeout: pick <span className="font-mono">Timeline Edits.json</span> (Takeout → Timeline).
            Old <span className="font-mono">Records.json</span> and phone <span className="font-mono">Timeline.json</span> exports work too.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={phase.kind === "parsing" || phase.kind === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {phase.kind === "parsing" ? "Reading…"
            : phase.kind === "uploading" ? `Uploading ${Math.min(phase.done + BATCH, phase.total)}/${phase.total}…`
            : "Choose file"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ""
          }}
        />
      </div>

      {phase.kind === "uploading" && (
        <div className="mt-2 h-1 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }}
          />
        </div>
      )}
      {phase.kind === "done" && (
        <p className="text-xs text-green-400 mt-2 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {phase.imported > 0
            ? `Imported ${phase.imported.toLocaleString()} GPS points (${phase.from} → ${phase.to}). Pick any of those days above to see the route.`
            : `All ${phase.total.toLocaleString()} points were already imported (${phase.from} → ${phase.to}).`}
        </p>
      )}
      {phase.kind === "error" && (
        <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {phase.message}
        </p>
      )}
    </div>
  )
}
