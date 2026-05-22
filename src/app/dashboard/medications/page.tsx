"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Pill, RefreshCw, Tag, Search } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

interface OuraTagItem {
  id: string
  day: string
  timestamp: Date
  text: string | null
  tags: string[]
}

export default function MedicationsPage() {
  const [items, setItems] = useState<OuraTagItem[]>([])
  const [filter, setFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (q = filter) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/medications${q ? `?filter=${encodeURIComponent(q)}` : ""}`)
      const data = await res.json()
      if (data.error) setError(data.error)
      setItems(data.items ?? [])
    } catch {
      setError("Failed to load")
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/sync/oura", { method: "POST" })
      const data = await res.json()
      if (data.success) await load()
    } finally {
      setSyncing(false)
    }
  }

  // Group items by day
  const byDay = items.reduce<Record<string, OuraTagItem[]>>((acc, item) => {
    acc[item.day] = [...(acc[item.day] ?? []), item]
    return acc
  }, {})

  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Pill className="h-6 w-6 text-primary" />
            Medication Log
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Synced from your Oura Ring tags
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter tags…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onKeyDown={e => e.key === "Enter" && load(filter)}
              className="h-8 pl-8 pr-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-44"
            />
          </div>
          <button
            onClick={() => load(filter)}
            className="h-8 px-3 text-sm rounded-lg border border-border bg-secondary/50 hover:bg-secondary transition-colors"
          >
            Search
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync Oura"}
          </button>
        </div>
      </div>

      {error && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-3 pb-3 text-sm text-yellow-400">
            {error.includes("tag") || error.includes("scope")
              ? "Tag scope not granted yet. Re-connect your Oura Ring in Settings to enable tag sync."
              : error}
          </CardContent>
        </Card>
      )}

      {!error && items.length === 0 && !loading && (
        <Card className="border-dashed">
          <CardContent className="pt-8 pb-8 text-center space-y-2">
            <Pill className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No tags found yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Log tags in your Oura app (e.g. "Vitamin D", "Magnesium"), then click Sync Oura above.
            </p>
            <p className="text-xs text-muted-foreground/40 mt-2">
              If you haven&apos;t connected Oura recently, re-connect in Settings to grant the tag scope.
            </p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          Loading…
        </div>
      )}

      <div className="space-y-6">
        {days.map(day => (
          <div key={day}>
            <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
              {format(new Date(day + "T12:00:00"), "EEEE, MMMM d")}
            </p>
            <div className="space-y-2">
              {byDay[day].map(item => (
                <Card key={item.id} className="border-border/50">
                  <CardContent className="pt-3 pb-3 flex items-start gap-3">
                    <div className="mt-0.5 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Pill className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">
                        {item.text ?? "(no note)"}
                      </p>
                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {item.tags.map(t => (
                            <span
                              key={t}
                              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground"
                            >
                              <Tag className="h-2.5 w-2.5" />
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground/60 shrink-0 mt-0.5">
                      {format(new Date(item.timestamp), "HH:mm")}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
