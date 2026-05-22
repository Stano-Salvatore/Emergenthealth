"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Database, CheckCircle, XCircle, Loader2 } from "lucide-react"

export function MigrateButton() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    setResults(null)
    try {
      const res = await fetch("/api/admin/migrate")
      const data = await res.json()
      if (data.results) setResults(data.results)
      else setError(data.error ?? "Unknown error")
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const hadErrors = results?.some(r => r.startsWith("✗"))

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Database className="h-4 w-4 text-primary" /> Database migrations
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Run after deploying a new version to apply schema changes
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={run} disabled={running} className="gap-1.5 shrink-0">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
            {running ? "Running…" : "Run migrations"}
          </Button>
        </div>

        {results && (
          <div className="rounded-lg bg-secondary/40 p-3 space-y-1 max-h-48 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`flex items-start gap-1.5 text-[11px] font-mono ${r.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>
                {r.startsWith("✓")
                  ? <CheckCircle className="h-3 w-3 shrink-0 mt-0.5" />
                  : <XCircle className="h-3 w-3 shrink-0 mt-0.5" />}
                <span>{r.slice(2)}</span>
              </div>
            ))}
            {!hadErrors && (
              <p className="text-xs text-green-400 font-medium pt-1">All migrations completed ✓</p>
            )}
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}
