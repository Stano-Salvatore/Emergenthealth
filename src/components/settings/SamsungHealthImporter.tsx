"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle2, XCircle, Smartphone } from "lucide-react"

type ImportState = "idle" | "uploading" | "done" | "error"

function FileImportRow({
  label,
  hint,
  onFile,
  state,
  count,
  error,
}: {
  label: string
  hint: string
  onFile: (file: File) => void
  state: ImportState
  count: number | null
  error: string | null
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
        {state === "done" && count != null && (
          <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> {count} rows imported
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
  const [combinedCount, setCombinedCount] = useState<number | null>(null)
  const [combinedError, setCombinedError] = useState<string | null>(null)

  const [moodState, setMoodState] = useState<ImportState>("idle")
  const [moodCount, setMoodCount] = useState<number | null>(null)
  const [moodError, setMoodError] = useState<string | null>(null)

  async function handleFile(file: File, type: "combined" | "mood") {
    const set = type === "combined"
      ? { setState: setCombinedState, setCount: setCombinedCount, setError: setCombinedError }
      : { setState: setMoodState, setCount: setMoodCount, setError: setMoodError }

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
      set.setCount(data.imported)
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
          Import your Samsung Health export. In Samsung Health → Profile → Data & privacy → Download personal data. Export as CSV and upload the files below.
        </p>

        <FileImportRow
          label="Health data (combined CSV)"
          hint="Sleep, steps, distance, calories, HR, weight, stress"
          onFile={f => handleFile(f, "combined")}
          state={combinedState}
          count={combinedCount}
          error={combinedError}
        />

        <FileImportRow
          label="Mood log (mood_scores CSV)"
          hint="Mood entries (1–5 scale)"
          onFile={f => handleFile(f, "mood")}
          state={moodState}
          count={moodCount}
          error={moodError}
        />
      </CardContent>
    </Card>
  )
}
