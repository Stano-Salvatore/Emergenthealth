"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle2, XCircle, Smartphone } from "lucide-react"

type ImportState = "idle" | "uploading" | "done" | "error"

type ImportResult = { imported: number; unchanged: number; failed: number }

function FileImportRow({
  label,
  hint,
  onFile,
  state,
  result,
  error,
}: {
  label: string
  hint: string
  onFile: (file: File) => void
  state: ImportState
  result: ImportResult | null
  error: string | null
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
        {state === "done" && result != null && (
          <p className={`text-xs mt-1 flex items-center gap-1 ${result.imported > 0 ? "text-green-400" : "text-muted-foreground"}`}>
            {result.imported > 0 && <CheckCircle2 className="h-3 w-3" />}
            {result.imported} {result.imported === 1 ? "day" : "days"} imported
            {result.unchanged > 0 && ` · ${result.unchanged} already stored, left as they were`}
          </p>
        )}
        {state === "done" && result != null && result.failed > 0 && (
          <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <XCircle className="h-3 w-3" /> {result.failed} {result.failed === 1 ? "day" : "days"} failed to save — importing again retries them
          </p>
        )}
        {state === "error" && error && (
          <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <XCircle className="h-3 w-3" /> {error}
          </p>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ""
        }}
      />
      <Button
        size="sm"
        variant={state === "done" ? "outline" : "default"}
        className="shrink-0 gap-1.5"
        disabled={state === "uploading"}
        onClick={() => ref.current?.click()}
      >
        {state === "uploading" ? (
          <>
            <Upload className="h-3.5 w-3.5 animate-bounce" />
            Importing…
          </>
        ) : state === "done" ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            Re-import
          </>
        ) : (
          <>
            <Upload className="h-3.5 w-3.5" />
            Choose file
          </>
        )}
      </Button>
    </div>
  )
}

export function SamsungHealthImporter() {
  const [combinedState, setCombinedState] = useState<ImportState>("idle")
  const [combinedResult, setCombinedResult] = useState<ImportResult | null>(null)
  const [combinedError, setCombinedError] = useState<string | null>(null)

  const [moodState, setMoodState] = useState<ImportState>("idle")
  const [moodResult, setMoodResult] = useState<ImportResult | null>(null)
  const [moodError, setMoodError] = useState<string | null>(null)

  async function handleFile(file: File, type: "combined" | "mood") {
    const set = type === "combined"
      ? { setState: setCombinedState, setResult: setCombinedResult, setError: setCombinedError }
      : { setState: setMoodState, setResult: setMoodResult, setError: setMoodError }

    set.setState("uploading")
    set.setError(null)
    try {
      const csv = await file.text()
      const res = await fetch("/api/import/samsung-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, csv }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      set.setResult({ imported: data.imported ?? 0, unchanged: data.unchanged ?? 0, failed: data.failed ?? 0 })
      set.setState("done")
    } catch (e) {
      set.setError(e instanceof Error ? e.message : "Import failed")
      set.setState("error")
    }
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-blue-400" />
          Samsung Health History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-xs text-muted-foreground mb-3">
          Import older history from CSV files with the columns below. Samsung Health&apos;s own &ldquo;Download personal data&rdquo; export is a folder of per-type files in a different layout and will not import here; convert it first. Recent Samsung data arrives through Health Connect. Days that already hold a value — from the ring, Health Connect or a weight you typed — keep it.
        </p>

        <FileImportRow
          label="Health data (combined CSV)"
          hint="date (YYYY-MM-DD), sleep_score, sleep_efficiency, sleep_duration_min, steps, distance_m, calories, weight_kg"
          onFile={f => handleFile(f, "combined")}
          state={combinedState}
          result={combinedResult}
          error={combinedError}
        />

        <FileImportRow
          label="Mood log (CSV)"
          hint="date (YYYY-MM-DD), time, mood_type (1–5). A day you already logged keeps your entry."
          onFile={f => handleFile(f, "mood")}
          state={moodState}
          result={moodResult}
          error={moodError}
        />
      </CardContent>
    </Card>
  )
}
