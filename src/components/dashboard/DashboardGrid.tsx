"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { ResponsiveGridLayout } from "react-grid-layout"
import type { LayoutItem, ResponsiveLayouts } from "react-grid-layout"
import { LayoutGrid, X } from "lucide-react"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"

// Measures the actual rendered width of the grid's container via
// ResizeObserver. Replaces the package's own useContainerWidth: in Web mode
// (wide scaled viewport) that hook was reporting a narrower width than the
// container's true rendered size, leaving the grid — and every widget in it
// — short of the available space with unused room on the right. Measuring
// the container element directly guarantees the grid always fills exactly
// what's actually there.
function useMeasuredWidth(initialWidth: number) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(initialWidth)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setWidth(w)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  return { containerRef, width }
}

export type BlockId =
  | "insights" | "health" | "finances" | "calendar" | "habits"
  | "reminders" | "gmail" | "quicklog" | "stats"
  | "location" | "ac" | "today" | "quests" | "quickstart" | "briefing"
  | "notes" | "insights_week" | "insights_month" | "insights_overall"

interface Block { id: BlockId; label: string }

const ALL_BLOCKS: Block[] = [
  { id: "insights",   label: "✨ Insights" },
  { id: "briefing",   label: "🌟 Daily Briefing" },
  { id: "today",      label: "🌅 Today" },
  { id: "health",     label: "❤️ Health" },
  { id: "finances",   label: "💰 Finances" },
  { id: "calendar",   label: "🗓️ Calendar" },
  { id: "habits",     label: "✅ Habits" },
  { id: "reminders",  label: "🔔 Reminders" },
  { id: "gmail",      label: "📬 Gmail" },
  { id: "quicklog",   label: "⚡ Quick Log" },
  { id: "stats",      label: "📊 Stats" },
  { id: "location",   label: "📍 Location" },
  { id: "ac",         label: "❄️ AC" },
  { id: "quests",     label: "⚔️ Quests" },
  { id: "quickstart", label: "🚀 Quick Start" },
  { id: "notes",      label: "📝 Notes" },
  { id: "insights_week",    label: "📈 Insights: 7 Days" },
  { id: "insights_month",   label: "📊 Insights: 30 Days" },
  { id: "insights_overall", label: "🌐 Insights: Overall" },
]

const DEFAULT_ITEMS: LayoutItem[] = [
  { i: "insights",    x: 0, y: 0,  w: 12, h: 14 },
  { i: "briefing",    x: 0, y: 14, w: 12, h: 4 },
  { i: "today",       x: 0, y: 18, w: 12, h: 8 },
  { i: "quickstart",  x: 0, y: 26, w: 6,  h: 10 },
  { i: "quests",      x: 6, y: 26, w: 6,  h: 10 },
  { i: "health",      x: 0, y: 36, w: 4,  h: 9 },
  { i: "finances",    x: 4, y: 36, w: 4,  h: 9 },
  { i: "calendar",    x: 8, y: 36, w: 4,  h: 9 },
  { i: "habits",      x: 0, y: 45, w: 4,  h: 7 },
  { i: "reminders",   x: 4, y: 45, w: 4,  h: 7 },
  { i: "gmail",       x: 8, y: 45, w: 4,  h: 7 },
  { i: "quicklog",    x: 0, y: 52, w: 12, h: 5 },
  { i: "stats",       x: 0, y: 57, w: 12, h: 4 },
  { i: "location",    x: 0, y: 61, w: 6,  h: 6 },
  { i: "ac",          x: 6, y: 61, w: 6,  h: 6 },
  { i: "notes",       x: 0, y: 67, w: 6,  h: 6 },
  { i: "insights_week",    x: 0, y: 73, w: 4, h: 11 },
  { i: "insights_month",   x: 4, y: 73, w: 4, h: 11 },
  { i: "insights_overall", x: 8, y: 73, w: 4, h: 11 },
]

const STORAGE_KEY = "dashboard-layout-v8"
// Bumped v1 → v2 to abandon any corrupt/over-aggressive hidden set that was
// hiding most widgets and leaving the dashboard near-empty. Starts fresh with
// nothing hidden so every widget shows again.
const HIDDEN_KEY  = "dashboard-hidden-v2"

// Always reconcile a saved layout against the full block set so no widget can
// ever silently disappear: a saved/stale layout that's missing blocks (e.g. an
// older cross-device copy) would otherwise drop them entirely, since the grid
// only renders items present in the array. We keep saved coords where valid,
// append any blocks the save didn't know about, and drop unknown ids.
function reconcile(saved: unknown): LayoutItem[] {
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_ITEMS
  const byId = new Map<string, LayoutItem>()
  for (const it of saved) {
    if (it && typeof it === "object" && typeof (it as LayoutItem).i === "string") {
      byId.set((it as LayoutItem).i, it as LayoutItem)
    }
  }
  return DEFAULT_ITEMS.map(def => {
    const s = byId.get(def.i)
    return s ? { ...def, ...s } : def
  })
}

function loadItems(): LayoutItem[] {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return reconcile(JSON.parse(r)) } catch { /* */ }
  return DEFAULT_ITEMS
}

interface Props {
  blocks: Partial<Record<BlockId, React.ReactNode>>
  header: React.ReactNode
}

// Edit-mode panel listing every available widget so the user can add or remove
// any of them from one place (not just re-add the ones they previously hid).
function WidgetGallery({
  blocks, hidden, onToggle,
}: {
  blocks: Partial<Record<BlockId, React.ReactNode>>
  hidden: Set<BlockId>
  onToggle: (id: BlockId) => void
}) {
  const available = ALL_BLOCKS.filter(b => blocks[b.id])
  const shownCount = available.filter(b => !hidden.has(b.id)).length
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-primary/80">Customize widgets — tap to show or hide</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">{shownCount}/{available.length} shown</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {available.map(b => {
          const shown = !hidden.has(b.id)
          return (
            <button
              key={b.id}
              onClick={() => onToggle(b.id)}
              aria-pressed={shown}
              className={`flex items-center justify-between gap-2 text-left text-xs px-2.5 py-2 rounded-lg border transition-all ${
                shown
                  ? "border-primary/30 bg-background/60 text-foreground"
                  : "border-dashed border-border text-muted-foreground/70 hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <span className="truncate">{b.label}</span>
              <span className={`shrink-0 text-[11px] font-bold ${shown ? "text-primary" : "text-muted-foreground/50"}`}>
                {shown ? "✓" : "+"}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DashboardGrid({ blocks, header }: Props) {
  const [items, setItems]     = useState<LayoutItem[]>(DEFAULT_ITEMS)
  const [hidden, setHidden]   = useState<Set<BlockId>>(new Set())
  const [editing, setEditing] = useState(false)
  const [ready, setReady]     = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  const { containerRef, width } = useMeasuredWidth(1280)

  // Refs so async/debounced saves always read the latest state.
  const itemsRef = useRef(items); itemsRef.current = items
  const hiddenRef = useRef(hidden); hiddenRef.current = hidden
  const editingRef = useRef(editing); editingRef.current = editing
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Persist layout + hidden widgets to the server so the arrangement syncs
  // across devices (web, phone, APK). Layout saves are debounced since
  // drag/resize fire many onLayoutChange events.
  const persist = useCallback((layout: LayoutItem[], hiddenArr: string[], debounce: boolean) => {
    const send = () => {
      fetch("/api/preferences/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout, hidden: hiddenArr }),
      }).catch(() => {})
    }
    if (debounce) {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(send, 600)
    } else {
      send()
    }
  }, [])

  useEffect(() => {
    // Local cache first for an instant paint.
    setItems(loadItems())
    try {
      const r = localStorage.getItem(HIDDEN_KEY)
      if (r) setHidden(new Set(JSON.parse(r)))
    } catch { /* */ }
    setReady(true)

    // Then the server copy (cross-device) — override local if a saved one exists.
    fetch("/api/preferences/dashboard")
      .then(r => (r.ok ? r.json() : null))
      .then((d: { layout?: LayoutItem[] | null; hidden?: string[] | null } | null) => {
        if (!d) return
        if (Array.isArray(d.layout) && d.layout.length > 0) {
          const merged = reconcile(d.layout)
          setItems(merged)
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)) } catch { /* */ }
        }
        if (Array.isArray(d.hidden)) {
          setHidden(new Set(d.hidden as BlockId[]))
          try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(d.hidden)) } catch { /* */ }
        }
      })
      .catch(() => {})
  }, [])

  // Track viewport width independently of the grid container: on phones we
  // render a plain vertical stack instead of the draggable 12-column grid,
  // which reuses desktop coordinates and breaks down in a single column
  // (widgets overlap or get flung down by their `y` values, leaving blank gaps).
  // BUT respect web/desktop layout mode — if the user has explicitly chosen the
  // desktop layout (persistent sidebar, zoomed out) we keep the full grid so it
  // fills the screen instead of cramming everything into one narrow column.
  useEffect(() => {
    const check = () => {
      const webMode = (() => { try { return localStorage.getItem("layout_mode") === "web" } catch { return false } })()
      setIsMobile(!webMode && window.innerWidth < 640)
    }
    check()
    window.addEventListener("resize", check)
    window.addEventListener("storage", check)
    return () => {
      window.removeEventListener("resize", check)
      window.removeEventListener("storage", check)
    }
  }, [])

  const onLayoutChange = useCallback((layout: readonly LayoutItem[]) => {
    const next = [...layout]
    setItems(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* */ }
    // Only sync deliberate edits — ignore the grid's mount/compaction echoes,
    // which fire when not editing and could clobber the server copy.
    if (editingRef.current) persist(next, [...hiddenRef.current] as string[], true)
  }, [persist])

  function toggleHide(id: BlockId) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])) } catch { /* */ }
      persist([...itemsRef.current], [...next] as string[], false)
      return next
    })
  }

  function resetLayout() {
    setItems(DEFAULT_ITEMS)
    setHidden(new Set())
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_ITEMS))
      localStorage.removeItem(HIDDEN_KEY)
    } catch { /* */ }
    persist(DEFAULT_ITEMS, [], false)
  }

  const visibleItems = items.filter(item => !hidden.has(item.i as BlockId))
  const layouts: ResponsiveLayouts = { lg: visibleItems, md: visibleItems, sm: visibleItems }

  if (!ready) {
    // Static fallback while measuring/hydrating
    return (
      <div className="space-y-5">
        {header}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {ALL_BLOCKS.filter(b => blocks[b.id]).map(b => (
            <div key={b.id}>{blocks[b.id]}</div>
          ))}
        </div>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {header}

        {/* toolbar — hide/show only (no drag on mobile) */}
        <div className="flex items-center justify-end gap-2">
          {editing && (
            <button onClick={resetLayout} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary/70 transition-colors">
              Reset
            </button>
          )}
          <button
            onClick={() => setEditing(e => !e)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${editing ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-border hover:text-foreground hover:border-primary/30"}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {editing ? "Done" : "Edit"}
          </button>
        </div>

        {editing && <WidgetGallery blocks={blocks} hidden={hidden} onToggle={toggleHide} />}

        <div className="space-y-4">
          {visibleItems.map(({ i }) => {
            const id = i as BlockId
            const node = blocks[id]
            if (!node) return null
            const meta = ALL_BLOCKS.find(b => b.id === id)
            return (
              <div key={i} className="relative">
                {editing && (
                  <button
                    onClick={() => toggleHide(id)}
                    className="absolute right-2 top-1 z-30 flex items-center justify-center h-7 w-7 rounded-md bg-background/60 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Remove ${meta?.label}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {node}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {header}

      {/* toolbar */}
      <div className="flex items-center justify-end gap-2">
        {editing && <span className="text-xs text-muted-foreground">Drag cards to rearrange · Resize from edges</span>}
        {editing && (
          <button onClick={resetLayout} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary/70 transition-colors">
            Reset
          </button>
        )}
        <button
          onClick={() => setEditing(e => !e)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${editing ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-border hover:text-foreground hover:border-primary/30"}`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          {editing ? "Done" : "Edit layout"}
        </button>
      </div>

      {/* widget gallery — add/remove any widget while editing */}
      {editing && <WidgetGallery blocks={blocks} hidden={hidden} onToggle={toggleHide} />}

      {/* grid */}
      <div ref={containerRef}>
        <ResponsiveGridLayout
          width={width}
          layouts={layouts}
          breakpoints={{ lg: 1024, md: 640, sm: 0 }}
          // Always 12 columns — never collapse to a single column. The 1-col
          // breakpoint reused the 12-col coordinates and produced overlapping
          // widgets and huge blank gaps whenever the measured container was
          // narrow (notably web layout mode in the APK, where the 0.5 zoom makes
          // the grid measure < 640px). Real phones use the separate vertical
          // stack above (isMobile), so this grid path can safely stay 12-col.
          cols={{ lg: 12, md: 12, sm: 12 }}
          rowHeight={36}
          margin={[16, 16]}
          dragConfig={{ enabled: editing, handle: ".drag-handle", bounded: false, threshold: 3 }}
          resizeConfig={{ enabled: editing, handles: ["se", "sw", "ne", "nw"] }}
          onLayoutChange={onLayoutChange}
        >
          {visibleItems.map(({ i }) => {
            const id = i as BlockId
            const node = blocks[id]
            if (!node) return null
            const meta = ALL_BLOCKS.find(b => b.id === id)

            return (
              <div key={i} className="relative">
                {editing && (
                  <>
                    {/* drag-handle only covers the left portion so react-draggable never sees the X button */}
                    <div className="drag-handle absolute inset-x-0 top-0 h-9 z-20 flex items-center pr-10 px-3 cursor-grab active:cursor-grabbing bg-primary/15 backdrop-blur-sm rounded-t-xl border-b border-primary/25 select-none">
                      <div className="flex items-center gap-1.5">
                        <div className="flex flex-col gap-0.5 opacity-40">
                          <div className="flex gap-0.5">
                            <div className="w-1 h-1 rounded-full bg-current" />
                            <div className="w-1 h-1 rounded-full bg-current" />
                          </div>
                          <div className="flex gap-0.5">
                            <div className="w-1 h-1 rounded-full bg-current" />
                            <div className="w-1 h-1 rounded-full bg-current" />
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-primary/80">{meta?.label}</span>
                      </div>
                    </div>
                    {/* X button sits outside drag-handle so no event capture conflict */}
                    <button
                      onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
                      onTouchStart={e => e.stopPropagation()}
                      onClick={() => toggleHide(id)}
                      className="absolute right-2 top-1 z-30 flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
                      aria-label={`Remove ${meta?.label}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                )}
                <div className={`h-full w-full overflow-auto [&>*]:w-full [&>*]:h-full ${editing ? "pt-9 rounded-xl ring-1 ring-primary/25" : ""}`}>
                  {node}
                </div>
              </div>
            )
          })}
        </ResponsiveGridLayout>
      </div>
    </div>
  )
}
