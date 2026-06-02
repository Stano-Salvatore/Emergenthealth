"use client"

import { useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Upload, FileSpreadsheet } from "lucide-react"

export function CsvImport() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ synced: number; format: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)

  async function handleFile(file: File) {
    setFilename(file.name)
    setImporting(true)
    setResult(null)
    setError(null)

    const form = new FormData()
    form.append("file", file)

    try {
      const res = await fetch("/api/import/csv", { method: "POST", body: form })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? "Import failed")
      else setResult({ synced: d.synced, format: d.format })
    } catch {
      setError("Network error — please try again")
    } finally {
      setImporting(false)
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ""
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Import CSV
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Export transactions from Revolut (or any bank) as CSV and upload here.
            Re-importing the same file is safe — duplicates are skipped.
          </p>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          className="border border-dashed rounded-md px-4 py-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          {importing ? (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing {filename}…
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Drop CSV here or <span className="text-primary underline">browse</span>
              </p>
              <p className="text-[11px] text-muted-foreground/60">Revolut, generic bank CSV · max 5 MB</p>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onFileChange}
        />

        {result && (
          <p className="text-xs text-green-400 bg-green-500/10 rounded-md px-3 py-2">
            Imported {result.synced} transactions
            {result.format === "revolut" ? " (Revolut format detected)" : ""}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</p>
        )}

        <details className="group">
          <summary className="text-[11px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">›</span>
            How to export from Revolut
          </summary>
          <ol className="text-[11px] text-muted-foreground/70 mt-1.5 ml-3 space-y-0.5 list-decimal list-inside">
            <li>Open Revolut app → tap your account</li>
            <li>Tap the ··· menu → Statement</li>
            <li>Choose date range → select CSV format</li>
            <li>Download and upload here</li>
          </ol>
        </details>
      </CardContent>
    </Card>
  )
}
