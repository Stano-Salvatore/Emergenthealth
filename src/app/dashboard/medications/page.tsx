"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { RefreshCw, Search, Pencil, CalendarDays, Tag } from "lucide-react"
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

// ── By-Type view: one card per unique tag type ───────────────────────────────

interface TagGroup {
  uuid: string | null      // null = tag with no type code
  name: string | null
  category: string
  emoji: string
  entries: TagItem[]
}

function buildGroups(items: TagItem[]): TagGroup[] {
  const map = new Map<string, TagGroup>()
  for (const item of items) {
    const key = item.tags[0] ?? `__no_uuid_${item.id}`
    if (!map.has(key)) {
      map.set(key, {
        uuid: item.tags[0] ?? null,
        name: item.tagName,
        category: item.category,
        emoji: item.emoji,
        entries: [],
      })
    }
    const g = map.get(key)!
    if (!g.name && item.tagName) { g.name = item.tagName; g.category = item.category; g.emoji = item.emoji }
    g.entries.push(item)
  }

  // Sort: named groups first (alphabetically), then unnamed (by UUID for stable order)
  return [...map.values()].sort((a, b) => {
    if (a.name && !b.name) return -1
    if (!a.name && b.name) return 1
    if (a.name && b.name) return a.name.localeCompare(b.name)
    return (a.uuid ?? "").localeCompare(b.uuid ?? "")
  })
}

function TypeCard({
  group,
  onRename,
}: {
  group: TagGroup
  onRename: (uuid: string, current: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const sorted = [...group.entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  const preview = sorted.slice(0, expanded ? sorted.length : 3)
  const lastSeen = sorted[0]?.day

  return (
    <Card className={cn("border-border/50", !group.name && "border-amber-500/20 bg-amber-500/3")}>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "h-9 w-9 rounded-full flex items-center justify-center shrink-0 border text-lg leading-none",
            CATEGORY_BG[group.category] ?? "bg-primary/10 text-primary border-primary/20"
          )}>
            {group.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={cn("text-sm font-semibold leading-snug", !group.name && "text-amber-400/80 italic")}>
                {group.name ?? "Unnamed tag"}
              </p>
              {group.uuid && (
                <button
                  onClick={() => onRename(group.uuid!, group.name ?? "")}
                  className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/40 hover:text-primary hover:bg-primary/10 active:bg-primary/20 transition-colors shrink-0"
                  title="Rename this tag type"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}
              {lastSeen && ` · last ${format(new Date(lastSeen + "T12:00:00"), "MMM d")}`}
            </p>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-muted-foreground/60 hover:text-foreground px-2 py-1 rounded transition-colors shrink-0"
          >
            {expanded ? "less" : "more"}
          </button>
        </div>

        {/* Entry list */}
        <div className="mt-2 space-y-1 ml-12">
          {preview.map(e => (
            <div key={e.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{format(new Date(e.day + "T12:00:00"), "MMM d")}</span>
              <span className="text-muted-foreground/50">{format(new Date(e.timestamp), "HH:mm")}</span>
              {e.text && e.text !== e.tagName && (
                <span className="flex-1 truncate text-left ml-2 italic">{e.text}</span>
              )}
            </div>
          ))}
          {!expanded && sorted.length > 3 && (
            <p className="text-xs text-muted-foreground/40 italic">+{sorted.length - 3} more…</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function MedicationsPage() {
  const [items, setItems] = useState<TagItem[]>([])
  const [filter, setFilter] = useState("")
  const [activeCategory, setActiveCategory] = useState("")
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"date" | "type">("type")
  const [renaming, setRenaming] = useState<{ uuid: string; current: string } | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)

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

  function startRename(uuid: string, current: string) {
    setRenaming({ uuid, current })
    setRenameValue(current)
  }

  async function submitRename() {
    if (!renaming || !renameValue.trim()) { setRenaming(null); return }
    setRenameSaving(true)
    try {
      await fetch("/api/tag-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagTypeUuid: renaming.uuid, name: renameValue.trim() }),
      })
      setRenaming(null)
      await load()
    } finally {
      setRenameSaving(false)
    }
  }

  // Computed values
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1
    return acc
  }, {})

  const unnamedTypeCount = new Set(
    items.filter(i => !i.tagName && i.tags[0]).map(i => i.tags[0])
  ).size

  // By-date grouping
  const byDay = items.reduce<Record<string, TagItem[]>>((acc, item) => {
    acc[item.day] = [...(acc[item.day] ?? []), item]
    return acc
  }, {})
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a))

  // By-type grouping
  const groups = buildGroups(items)

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
              className="h-8 pl-8 pr-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-36"
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

      {/* View toggle + category tabs */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
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

        {/* View mode toggle */}
        <div className="flex items-center rounded-lg border border-border bg-secondary/30 p-0.5 gap-0.5 shrink-0">
          <button
            onClick={() => setViewMode("type")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
              viewMode === "type" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Tag className="h-3 w-3" />
            By Type
          </button>
          <button
            onClick={() => setViewMode("date")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
              viewMode === "date" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarDays className="h-3 w-3" />
            By Date
          </button>
        </div>
      </div>

      {/* Unnamed tags prompt */}
      {unnamedTypeCount > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-amber-400">
              <span className="font-semibold">{unnamedTypeCount} unnamed tag {unnamedTypeCount === 1 ? "type" : "types"}</span>
              {" "}— tap ✏️ on any entry to name it. Naming one renames all entries of that type.
            </p>
          </CardContent>
        </Card>
      )}

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
              Log tags in your Oura app (e.g. &quot;Vitamin D&quot;, &quot;Coffee&quot;), then click Sync above.
            </p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading…</div>
      )}

      {/* ── By Type view ── */}
      {!loading && viewMode === "type" && groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group, i) => (
            <TypeCard
              key={group.uuid ?? `no-uuid-${i}`}
              group={group}
              onRename={startRename}
            />
          ))}
        </div>
      )}

      {/* ── By Date view ── */}
      {!loading && viewMode === "date" && (
        <div className="space-y-8">
          {days.map(day => {
            const dayItems = byDay[day]
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
                                <div className="flex items-center gap-2">
                                  <p className={cn("text-sm font-semibold leading-snug", !item.tagName && "text-amber-400/80 italic")}>
                                    {item.tagName ?? "Unnamed tag"}
                                  </p>
                                  {item.tags[0] && (
                                    <button
                                      onClick={() => startRename(item.tags[0], item.tagName ?? "")}
                                      className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/40 hover:text-primary hover:bg-primary/10 active:bg-primary/20 transition-colors shrink-0"
                                      title="Rename this tag type"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                                {item.text && item.text !== item.tagName && (
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
      )}

      {/* Rename modal */}
      {renaming && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) setRenaming(null) }}
        >
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-base">Name this tag type</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Renames all entries of this tag type across all days.</p>
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setRenaming(null) }}
              placeholder="e.g. Vitamin D, Coffee, Ibuprofen…"
              className="w-full text-sm bg-secondary/60 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setRenaming(null)}
                className="flex-1 h-11 rounded-xl border border-border text-sm text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitRename}
                disabled={renameSaving || !renameValue.trim()}
                className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {renameSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
