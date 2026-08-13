"use client"

import { useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { FileUp, X } from "lucide-react"

// Photograph the printout or drop in the lab's PDF. Nothing is saved until
// every row has been seen next to the original and confirmed — a transcription
// the user hasn't checked has no business in a health record, and a wrong
// number here would quietly follow them through every chart in the app.

interface Row {
  marker: string
  rawMarker: string
  value: number
  unit: string
  referenceMin: number | null
  referenceMax: number | null
  flag: "low" | "high" | "normal" | null
}

interface Parsed {
  date: string | null
  lab: string | null
  results: Row[]
  unreadable: string[]
  note: string | null
  disclaimer?: string
}

/** Long edge cap for photos — plenty for printed text, far less to upload. */
const MAX_EDGE = 2200

async function toDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error("read failed"))
    fr.readAsDataURL(file)
  })
  // PDFs go up untouched; re-encoding one would only lose text.
  if (!file.type.startsWith("image/")) return raw

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("decode failed"))
    el.src = raw
  })
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  if (scale === 1) return raw

  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) return raw
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  // 0.92 rather than the usual 0.8: JPEG artefacts around small print are
  // exactly what turns a 7 into a 1.
  return canvas.toDataURL("image/jpeg", 0.92)
}

export function LabImportCard({ onSaved }: { onSaved: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [keep, setKeep] = useState<boolean[]>([])
  const [date, setDate] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    setParsed(null)
    try {
      const document = await toDataUrl(file)
      const res = await fetch("/api/labs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Couldn't read that file.")
        return
      }
      setParsed(data)
      setRows(data.results ?? [])
      setKeep((data.results ?? []).map(() => true))
      setDate(data.date ?? new Date().toISOString().slice(0, 10))
    } catch {
      setError("Couldn't read that file.")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function editRow(i: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function save() {
    const chosen = rows.filter((_, i) => keep[i])
    if (chosen.length === 0 || !date) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/labs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          results: chosen.map(r => ({
            marker: r.marker,
            value: r.value,
            unit: r.unit,
            referenceMin: r.referenceMin,
            referenceMax: r.referenceMax,
            notes: parsed?.lab ? `Imported from ${parsed.lab}` : "Imported from a document",
          })),
        }),
      })
      if (!res.ok) throw new Error()
      setParsed(null)
      setRows([])
      onSaved()
    } catch {
      setError("Couldn't save those results.")
    } finally {
      setSaving(false)
    }
  }

  const chosenCount = keep.filter(Boolean).length

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="pt-3 pb-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold">📄 Import from a photo or PDF</p>
            <p className="text-[11px] text-muted-foreground">
              Every marker on the page in one go, instead of typing them one at a time.
            </p>
          </div>
          {!parsed && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileUp className="h-3.5 w-3.5 mr-1" />
              {busy ? "Reading…" : "Choose file"}
            </Button>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />

        {error && <p className="text-[11px] text-rose-400">{error}</p>}

        {parsed && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[11px] text-muted-foreground">Sample date</label>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="h-7 w-36 text-xs"
              />
              {parsed.lab && <span className="text-[11px] text-muted-foreground">· {parsed.lab}</span>}
              <button
                onClick={() => { setParsed(null); setRows([]); setError(null) }}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {!parsed.date && (
              <p className="text-[11px] text-amber-400">
                No date was printed where the reader could find it — check this one before saving.
              </p>
            )}

            <div className="space-y-1">
              {rows.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                    keep[i] ? "border-border bg-card/60" : "border-border/40 opacity-50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={keep[i]}
                    onChange={e => setKeep(prev => prev.map((k, j) => (j === i ? e.target.checked : k)))}
                    className="h-3.5 w-3.5 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <Input
                      value={r.marker}
                      onChange={e => editRow(i, { marker: e.target.value })}
                      className="h-6 border-0 bg-transparent px-0 text-xs font-medium focus-visible:ring-0"
                    />
                    {r.rawMarker && r.rawMarker !== r.marker && (
                      <p className="text-[10px] text-muted-foreground truncate">printed as “{r.rawMarker}”</p>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="any"
                    value={r.value}
                    onChange={e => editRow(i, { value: Number(e.target.value) })}
                    className="h-6 w-20 text-xs tabular-nums"
                  />
                  <Input
                    value={r.unit}
                    onChange={e => editRow(i, { unit: e.target.value })}
                    className="h-6 w-20 text-xs"
                  />
                  <span className="w-24 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
                    {r.referenceMin != null || r.referenceMax != null
                      ? `${r.referenceMin ?? "–"}–${r.referenceMax ?? "–"}`
                      : "no range"}
                    {r.flag === "high" && <span className="text-rose-400"> ↑</span>}
                    {r.flag === "low" && <span className="text-amber-400"> ↓</span>}
                  </span>
                </div>
              ))}
            </div>

            {rows.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No readable result rows were found on that page.</p>
            )}

            {parsed.unreadable.length > 0 && (
              <p className="text-[11px] text-amber-400">
                Couldn&apos;t read: {parsed.unreadable.join(", ")} — add those by hand, or retake the photo straighter.
              </p>
            )}
            {parsed.note && <p className="text-[11px] text-muted-foreground">{parsed.note}</p>}

            <p className="text-[10px] text-muted-foreground/80 leading-snug">{parsed.disclaimer}</p>

            <div className="flex justify-end">
              <Button size="sm" onClick={save} disabled={saving || chosenCount === 0 || !date}>
                {saving ? "Saving…" : `Save ${chosenCount} result${chosenCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
