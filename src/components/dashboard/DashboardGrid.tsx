"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { ResponsiveGridLayout, useContainerWidth } from "react-grid-layout"
import type { LayoutItem, ResponsiveLayouts } from "react-grid-layout"
import { LayoutGrid, X } from "lucide-react"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"

export type BlockId =
  | "health" | "finances" | "calendar" | "habits"
  | "reminders" | "gmail" | "quicklog" | "stats"
  | "location" | "ac" | "today" | "quests"

interface Block { id: BlockId; label: string }

const ALL_BLOCKS: Block[] = [
  { id: "today",     label: "🌅 Today" },
  { id: "health",    label: "❤️ Health" },
  { id: "finances",  label: "💰 Finances" },
  { id: "calendar",  label: "🗓️ Calendar" },
  { id: "habits",    label: "✅ Habits" },
  { id: "reminders", label: "🔔 Reminders" },
  { id: "gmail",     label: "📬 Gmail" },
  { id: "quicklog",  label: "⚡ Quick Log" },
  { id: "stats",     label: "📊 Stats" },
  { id: "location",  label: "📍 Location" },
  { id: "ac",        label: "❄️ AC" },
  { id: "quests",    label: "⚔️ Quests" },
]

const DEFAULT_ITEMS: LayoutItem[] = [
  { i: "today",     x: 0, y: 0,  w: 12, h: 8 },
  { i: "health",    x: 0, y: 8,  w: 4, h: 9 },
  { i: "finances",  x: 4, y: 8,  w: 4, h: 9 },
  { i: "calendar",  x: 8, y: 8,  w: 4, h: 9 },
  { i: "habits",    x: 0, y: 17, w: 4, h: 7 },
  { i: "reminders", x: 4, y: 17, w: 4, h: 7 },
  { i: "gmail",     x: 8, y: 17, w: 4, h: 7 },
  { i: "quicklog",  x: 0, y: 24, w: 12, h: 5 },
  { i: "stats",     x: 0, y: 29, w: 12, h: 4 },
  { i: "location",  x: 0, y: 33, w: 6,  h: 6 },
  { i: "ac",        x: 6, y: 33, w: 6,  h: 6 },
  { i: "quests",    x: 0, y: 39, w: 6,  h: 8 },
]

const STORAGE_KEY = "dashboard-layout-v5"
const HIDDEN_KEY  = "dashboard-hidden-v1"

function loadItems(): LayoutItem[] {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r) } catch { /* */ }
  return DEFAULT_ITEMS
}

interface Props {
  blocks: Partial<Record<BlockId, React.ReactNode>>
  header: React.ReactNode
}

export function DashboardGrid({ blocks, header }: Props) {
  const [items, setItems]     = useState<LayoutItem[]>(DEFAULT_ITEMS)
  const [hidden, setHidden]   = useState<Set<BlockId>>(new Set())
  const [editing, setEditing] = useState(false)
  const [ready, setReady]     = useState(false)

  const { containerRef, width } = useContainerWidth({ initialWidth: 1280 })

  useEffect(() => {
    setItems(loadItems())
    try {
      const r = localStorage.getItem(HIDDEN_KEY)
      if (r) setHidden(new Set(JSON.parse(r)))
    } catch { /* */ }
    setReady(true)
  }, [])

  const onLayoutChange = useCallback((layout: readonly LayoutItem[]) => {
    const next = [...layout]
    setItems(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* */ }
  }, [])

  function toggleHide(id: BlockId) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])) } catch { /* */ }
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

      {/* re-add hidden blocks while editing */}
      {editing && hidden.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {ALL_BLOCKS.filter(b => hidden.has(b.id) && blocks[b.id]).map(b => (
            <button key={b.id} onClick={() => toggleHide(b.id)}
              className="text-xs px-2.5 py-1 rounded-full border border-dashed border-primary/40 text-primary/70 hover:text-primary hover:border-primary transition-colors">
              + {b.label}
            </button>
          ))}
        </div>
      )}

      {/* grid */}
      <div ref={containerRef}>
        <ResponsiveGridLayout
          width={width}
          layouts={layouts}
          breakpoints={{ lg: 1024, md: 640, sm: 0 }}
          cols={{ lg: 12, md: 12, sm: 1 }}
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
                <div className={`h-full overflow-auto ${editing ? "pt-9 rounded-xl ring-1 ring-primary/25" : ""}`}>
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
