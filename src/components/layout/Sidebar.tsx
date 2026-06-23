"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { X, Settings2, GripVertical, Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useEffect, useCallback } from "react"
import {
  DndContext, closestCenter,
  PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

type NavItem = { href: string; label: string; emoji: string }

const ALL_ITEMS: NavItem[] = [
  { href: "/dashboard",             label: "Overview",        emoji: "🏠" },
  { href: "/dashboard/chat",        label: "Emergy",          emoji: "🌱" },
  { href: "/dashboard/checkin",     label: "Check-in",        emoji: "🌅" },
  { href: "/dashboard/habits",      label: "Habits",          emoji: "✅" },
  { href: "/dashboard/medications", label: "Medications",     emoji: "💊" },
  { href: "/dashboard/intake",      label: "Intake",          emoji: "🥤" },
  { href: "/dashboard/health",      label: "Health",          emoji: "❤️" },
  { href: "/dashboard/body",        label: "Body & Trackers", emoji: "📏" },
  { href: "/dashboard/calendar",    label: "Calendar",        emoji: "🗓️" },
  { href: "/dashboard/reminders",   label: "Reminders",       emoji: "🔔" },
  { href: "/dashboard/location",    label: "Location",        emoji: "📍" },
  { href: "/dashboard/settings",    label: "Settings",        emoji: "⚙️" },
  // Hidden by default but still accessible via Customize
  { href: "/dashboard/week",        label: "This Week",       emoji: "📅" },
  { href: "/dashboard/timeline",    label: "Timeline",        emoji: "🕐" },
  { href: "/dashboard/stats",       label: "Insights",        emoji: "💡" },
  { href: "/dashboard/streaks",     label: "Streaks",         emoji: "🔥" },
  { href: "/dashboard/gmail",       label: "Gmail",           emoji: "📬" },
  { href: "/dashboard/reading",     label: "Reading",         emoji: "📚" },
  { href: "/dashboard/strava",      label: "Strava",          emoji: "🏃" },
  { href: "/dashboard/lastfm",      label: "Last.fm",         emoji: "🎵" },
  { href: "/dashboard/rescuetime",  label: "RescueTime",      emoji: "⏱️" },
  { href: "/dashboard/journal",     label: "Journal",         emoji: "📝" },
  { href: "/dashboard/focus",       label: "Focus",           emoji: "🎯" },
  { href: "/dashboard/fasting",     label: "Fasting",         emoji: "⏱️" },
  { href: "/dashboard/finances",    label: "Finances",        emoji: "💰" },
  { href: "/dashboard/subscriptions", label: "Subscriptions", emoji: "🔄" },
  { href: "/dashboard/bills",       label: "Bills",           emoji: "🧾" },
  { href: "/dashboard/home",        label: "Home",            emoji: "🏡" },
  { href: "/dashboard/garden",      label: "Garden",          emoji: "🌻" },
  { href: "/dashboard/custom",      label: "Trackers",        emoji: "📐" },
]

const DEFAULT_ORDER = ALL_ITEMS.map(i => i.href)
const DEFAULT_HIDDEN = new Set([
  "/dashboard/week",
  "/dashboard/timeline",
  "/dashboard/stats",
  "/dashboard/streaks",
  "/dashboard/gmail",
  "/dashboard/reading",
  "/dashboard/strava",
  "/dashboard/lastfm",
  "/dashboard/rescuetime",
  "/dashboard/journal",
  "/dashboard/focus",
  "/dashboard/fasting",
  "/dashboard/finances",
  "/dashboard/subscriptions",
  "/dashboard/bills",
  "/dashboard/home",
  "/dashboard/garden",
  "/dashboard/custom",
])
const NON_HIDEABLE = new Set(["/dashboard", "/dashboard/settings", "/dashboard/chat"])
const LS_HIDDEN     = "sidebar-hidden-v2"
const LS_ORDER      = "sidebar-order-v1"

function SortableItem({
  item, active, isHidden, editing, onToggleHidden, onClose,
}: {
  item: NavItem
  active: boolean
  isHidden: boolean
  editing: boolean
  onToggleHidden: () => void
  onClose?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.href, disabled: !editing })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center rounded-lg", isDragging && "opacity-40 z-50 bg-secondary/60")}
    >
      {editing && (
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center w-6 h-8 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/25 hover:text-muted-foreground/50 touch-none select-none"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
      )}

      <Link
        href={item.href}
        onClick={() => { if (onClose && window.innerWidth < 1024) onClose() }}
        className={cn(
          "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-150 flex-1 min-w-0",
          active
            ? "bg-gradient-to-r from-primary/20 to-primary/5 text-primary font-semibold border border-primary/25 shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
          isHidden && "opacity-35",
        )}
      >
        <span className="text-base leading-none w-5 text-center shrink-0">{item.emoji}</span>
        <span className={cn("text-sm truncate", isHidden && "line-through")}>{item.label}</span>
      </Link>

      {editing && !NON_HIDEABLE.has(item.href) && (
        <button
          onClick={onToggleHidden}
          className="p-1.5 shrink-0 text-muted-foreground/25 hover:text-muted-foreground/70 transition-colors"
          aria-label={isHidden ? "Show" : "Hide"}
        >
          {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  )
}

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const [order,   setOrder]   = useState<string[]>(DEFAULT_ORDER)
  const [hidden,  setHidden]  = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState(false)
  const [bottomHovered, setBottomHovered] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    const lsH = localStorage.getItem(LS_HIDDEN)
    const lsO = localStorage.getItem(LS_ORDER)
    if (lsH) try { setHidden(new Set(JSON.parse(lsH))) } catch {}
    else setHidden(new Set(DEFAULT_HIDDEN))
    if (lsO) try { setOrder(JSON.parse(lsO)) } catch {}

    fetch("/api/preferences/sidebar")
      .then(r => r.json())
      .then(d => {
        // Only override defaults if user has an explicit saved preference
        if (Array.isArray(d.hidden) && d.hidden.length > 0) {
          setHidden(new Set(d.hidden))
          localStorage.setItem(LS_HIDDEN, JSON.stringify(d.hidden))
        } else if (!lsH) {
          // No saved pref anywhere — persist the defaults so reset works correctly
          localStorage.setItem(LS_HIDDEN, JSON.stringify([...DEFAULT_HIDDEN]))
        }
        if (Array.isArray(d.order) && d.order.length > 0) {
          setOrder(d.order)
          localStorage.setItem(LS_ORDER, JSON.stringify(d.order))
        }
      })
      .catch(() => {})
  }, [])

  const persist = useCallback((nextOrder: string[], nextHidden: Set<string>) => {
    const h = [...nextHidden]
    localStorage.setItem(LS_HIDDEN, JSON.stringify(h))
    localStorage.setItem(LS_ORDER,  JSON.stringify(nextOrder))
    fetch("/api/preferences/sidebar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: nextOrder, hidden: h }),
    }).catch(() => {})
  }, [])

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = order.indexOf(active.id as string)
    const to   = order.indexOf(over.id as string)
    const next = arrayMove(order, from, to)
    setOrder(next)
    persist(next, hidden)
  }

  function toggleHidden(href: string) {
    if (NON_HIDEABLE.has(href)) return
    const next = new Set(hidden)
    next.has(href) ? next.delete(href) : next.add(href)
    setHidden(next)
    persist(order, next)
  }

  function reset() {
    setOrder(DEFAULT_ORDER)
    setHidden(new Set())
    persist(DEFAULT_ORDER, new Set())
  }

  // Respect stored order, append any new items not yet saved
  const orderedItems = [
    ...order.map(href => ALL_ITEMS.find(i => i.href === href)).filter(Boolean) as NavItem[],
    ...ALL_ITEMS.filter(i => !order.includes(i.href)),
  ]
  const displayItems = editing ? orderedItems : orderedItems.filter(i => !hidden.has(i.href))

  return (
    <aside
      className="w-56 shrink-0 h-screen flex flex-col border-r border-border"
      style={{ background: "linear-gradient(180deg, var(--sidebar-from) 0%, var(--sidebar-to) 100%)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-border/60">
        <div className="relative shrink-0">
          <div className="absolute inset-0 bg-primary/50 rounded-lg blur-md" />
          <div className="relative bg-gradient-to-br from-primary to-primary/60 rounded-lg p-1.5 text-sm leading-none flex items-center justify-center w-7 h-7">
            💚
          </div>
        </div>
        <span className="font-bold text-sm text-gradient flex-1">Emergenthealth</span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 overflow-y-auto scrollbar-thin">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayItems.map(i => i.href)} strategy={verticalListSortingStrategy}>
            <div className="space-y-0.5">
              {displayItems.map(item => (
                <SortableItem
                  key={item.href}
                  item={item}
                  active={pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))}
                  isHidden={hidden.has(item.href)}
                  editing={editing}
                  onToggleHidden={() => toggleHidden(item.href)}
                  onClose={onClose}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {editing && (
          <p className="text-[10px] text-muted-foreground/40 text-center mt-3 px-2">
            Drag to reorder · Eye to hide
          </p>
        )}
      </nav>

      {/* Bottom */}
      <div
        className="p-3 border-t border-border/60 space-y-1"
        onMouseEnter={() => setBottomHovered(true)}
        onMouseLeave={() => setBottomHovered(false)}
      >
        {editing ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Done</button>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Reset</button>
          </div>
        ) : (
          <div className={cn("transition-opacity duration-150", bottomHovered ? "opacity-100" : "opacity-0")}>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all"
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              Customize
            </button>
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/signin" })}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all"
        >
          <span className="text-base leading-none w-5 text-center shrink-0">👋</span>
          Sign out
        </button>
      </div>
    </aside>
  )
}
