"use client"

import { useRef, useState } from "react"
import { Upload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { parseWatchHistory } from "@/lib/ytmusic-import"

// One-shot backfill from a Google Takeout of YouTube Music. The 40 MB
// watch-history.html never leaves the phone — it's parsed right here in the
// browser and only the extracted plays (a couple hundred KB) go to the server,
// which folds them into the same per-day rows Last.fm scrobbles land in.
// Days Last.fm already covers are left untouched.

interface ImportResult {
  days: number
  skippedDays: number
  tracks: number
  from: string | null
  to: string | null
}

function fmtDate(d: string | null): string {
  if (!d) return "?"
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short", year: "numeric",
  })
}

export function YtMusicImport({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<"parsing" | "uploading" | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setBusy("parsing")
    setResult(null)
    setError(null)
    try {
      const plays = parseWatchHistory(await file.text())
      if (plays.length === 0) {
        setError(
          "No music plays found in that file. Make sure it's watch-history.html from a Takeout " +
          "of YouTube and YouTube Music — and note the importer only reads English-language exports " +
          "(Google Account language set to English when exporting)."
        )
        return
      }
      setBusy("uploading")
      const res = await fetch("/api/import/ytmusic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plays }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? `Import failed (${res.status})`)
      }
      const data: ImportResult = await res.json()
      setResult(data)
      if (data.days > 0) onImported()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="rounded-xl border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">YouTube Music history</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Backfill days from before Last.fm: upload <span className="font-mono">watch-history.html</span> from
            a <a href="https://takeout.google.com" target="_blank" rel="noreferrer" className="text-rose-400 hover:underline">Google Takeout</a> of
            YouTube and YouTube Music. Parsed on your device; days that already have listening data are left alone.
          </p>
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg bg-rose-500/15 text-rose-400 px-3 py-2 text-sm font-medium hover:bg-rose-500/25 transition-colors disabled:opacity-50 shrink-0"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {busy === "parsing" ? "Reading…" : busy === "uploading" ? "Importing…" : "Import"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".html,text/html"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>

      {result && (
        <div className="flex items-start gap-2 text-xs text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>
            Imported {result.tracks.toLocaleString()} plays into {result.days} day{result.days === 1 ? "" : "s"} ({fmtDate(result.from)} → {fmtDate(result.to)}).
            {/* Not "already had Last.fm data": the server counts a skip on any
                existing row, and LastfmLog carries no column saying which
                source wrote it. Days inserted by an EARLIER run of this same
                import land in the same counter, so a re-upload — the natural
                way to check an import actually landed — used to report that
                Last.fm covered days it had never touched. */}
            {result.skippedDays > 0 && (
              <span className="text-muted-foreground"> {result.skippedDays} day{result.skippedDays === 1 ? "" : "s"} already had listening data and were left untouched.</span>
            )}
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}
