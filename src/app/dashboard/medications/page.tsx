"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { RefreshCw, Search } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

interface TagItem {
  id: string
  day: string
  timestamp: Date
  tagName: string | null
  text: string | null
  tags: string[]
  category: string
  emoji: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(s: string | null): boolean { return !!s && UUID_RE.test(s.trim()) }

const CATEGORIES = [
  { id: "",            label: "All",         emoji: "✨" },
  { id: "Medications", label: "Medications", emoji: "💊" },
  { id: "Vitamins",    label: "Vitamins",    emoji: "🌿" },
  { id: "Drinks",      label: "Drinks",      emoji: "🥤" },
  { id: "General",     label: "General",     emoji: "🏷️" },
]

const CATEGORY_BG: Record<string, string> = {
  Medications: "bg-red-500/10 text-red-400 border-red-500/20",
  Vitamins:    "bg-green-500/10 text-green-400 border-green-500/20",
  Drinks:      "bg-sky-500/10 text-sky-400 border-sky-500/20",
  General:     "bg-primary/10 text-primary border-primary/20",
}

export default function MedicationsPage() {
  const [items, setItems] = useState<TagItem[]>([])
  const [filter, setFilter] = useState("")
  const [activeCategory, setActiveCategory] = useState("")
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (q = filter, cat = activeCategory) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q) params.set("filter", q)
      if (cat) params.set("category", cat)
      const res = await fetch(`/api/medications${params.toString() ? `?${params}` : ""}`)
      const data = await res.json()
      if (data.error) setError(data.error)
      setItems(data.items ?? [])
    } catch {
      setError("Failed to load")
    } finally {
      setLoading(false)
    }
  }, [filter, activeCategory])

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

  function switchCategory(cat: string) {
    setActiveCategory(cat)
    load(filter, cat)
  }

  // Group by day then within day by category
  const byDay = items.reduce<Record<string, TagItem[]>>((acc, item) => {
    acc[item.day] = [...(acc[item.day] ?? []), item]
    return acc
  }, {})
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a))

  // Category counts
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-2xl">💊</span>
            Tag Log
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Medications, vitamins &amp; drinks logged via Oura Ring tags
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onKeyDown={e => e.key === "Enter" && load(filter, activeCategory)}
              className="h-8 pl-8 pr-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-40"
            />
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORIES.map(cat => {
          const count = cat.id ? (counts[cat.id] ?? 0) : items.length
          return (
            <button
              key={cat.id}
              onClick={() => switchCategory(cat.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border",
                activeCategory === cat.id
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground hover:border-primary/30"
              )}
            >
              <span className="text-base leading-none">{cat.emoji}</span>
              {cat.label}
              {count > 0 && (
                <span className={cn(
                  "text-[10px] rounded-full px-1.5 py-0.5 leading-none",
                  activeCategory === cat.id ? "bg-white/20" : "bg-secondary text-muted-foreground"
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
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
            <p className="text-4xl">💊</p>
            <p className="text-sm text-muted-foreground">No tags found yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Log tags in your Oura app (e.g. "Vitamin D", "Coffee"), then click Sync above.
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

      <div className="space-y-8">
        {days.map(day => {
          const dayItems = byDay[day]
          // Group items within this day by category
          const byCat = dayItems.reduce<Record<string, TagItem[]>>((acc, item) => {
            acc[item.category] = [...(acc[item.category] ?? []), item]
            return acc
          }, {})
          const catOrder = ["Medications", "Vitamins", "Drinks", "General"]
          const presentCats = catOrder.filter(c => byCat[c]?.length)

          return (
            <div key={day}>
              <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
                {format(new Date(day + "T12:00:00"), "EEEE, MMMM d")}
              </p>
              <div className="space-y-4">
                {presentCats.map(cat => (
                  <div key={cat}>
                    {/* Show category header only when showing All */}
                    {!activeCategory && (
                      <p className="text-xs font-medium text-muted-foreground/50 mb-1.5 flex items-center gap-1.5 pl-1">
                        <span>{CATEGORIES.find(c => c.id === cat)?.emoji}</span>
                        {cat}
                      </p>
                    )}
                    <div className="space-y-2">
                      {byCat[cat].map(item => (
                        <Card key={item.id} className="border-border/50">
                          <CardContent className="pt-3 pb-3 flex items-start gap-3">
                            <div className={cn(
                              "mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0 border text-lg leading-none",
                              CATEGORY_BG[item.category] ?? "bg-primary/10 text-primary border-primary/20"
                            )}>
                              {item.emoji}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold leading-snug">
                                {isUuid(item.tagName) || !item.tagName
                                  ? (item.text && !isUuid(item.text) ? item.text : "Unsynced tag")
                                  : item.tagName}
                              </p>
                              {item.text && !isUuid(item.text) && item.text !== item.tagName && (
                                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                                  {item.text}
                                </p>
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
        })}
      </div>
    </div>
  )
}
