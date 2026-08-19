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
import { isRouteEnabled } from "@/lib/features"
import { EmergyAvatar, type EmergyState } from "@/components/emergy/EmergyAvatar"

// Four rooms rather than one 27-item list: where you are now, what your body
// is doing, the rest of life, and what the data means. Headers only render
// while the order is untouched — once someone drags an item the grouping is
// theirs, not ours, so it steps out of the way.
type NavSection = "Today" | "Body" | "Life" | "Patterns"
type NavItem = { href: string; label: string; emoji: string; section: NavSection }

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard",             label: "Overview",        emoji: "🏠", section: "Today" },
  { href: "/dashboard/brief",       label: "Brief",           emoji: "🗞️", section: "Today" },
  { href: "/dashboard/chat",        label: "Emergy",          emoji: "🌱", section: "Today" },
  { href: "/dashboard/checkin",     label: "Check-in",        emoji: "🌅", section: "Today" },
  { href: "/dashboard/habits",      label: "Habits",          emoji: "✅", section: "Today" },
  { href: "/dashboard/garden",      label: "Garden",          emoji: "🌻", section: "Today" },

  // Medications live as a tab inside Intake, Body & Trackers as a tab inside
  // Health — one nav entry each instead of two.
  { href: "/dashboard/intake",      label: "Intake & Meds",   emoji: "🥤", section: "Body" },
  { href: "/dashboard/health",      label: "Health & Body",   emoji: "❤️", section: "Body" },
  { href: "/dashboard/medications", label: "Medications",     emoji: "💊", section: "Body" },
  { href: "/dashboard/symptoms",    label: "Symptoms",        emoji: "🩹", section: "Body" },
  { href: "/dashboard/labs",        label: "Blood work",      emoji: "🧪", section: "Body" },
  { href: "/dashboard/report",      label: "Health report",   emoji: "📄", section: "Body" },
  { href: "/dashboard/body",        label: "Body composition", emoji: "📐", section: "Body" },
  { href: "/dashboard/weight",      label: "Weight",          emoji: "⚖️", section: "Body" },
  { href: "/dashboard/caffeine",    label: "Caffeine",        emoji: "☕", section: "Body" },
  { href: "/dashboard/fasting",     label: "Fasting",         emoji: "⏳", section: "Body" },
  { href: "/dashboard/strava",      label: "Strava",          emoji: "🏃", section: "Body" },

  { href: "/dashboard/calendar",    label: "Calendar",        emoji: "🗓️", section: "Life" },
  { href: "/dashboard/reminders",   label: "Reminders",       emoji: "🔔", section: "Life" },
  { href: "/dashboard/focus",       label: "Focus",           emoji: "🎯", section: "Life" },
  { href: "/dashboard/toggl",       label: "Toggl",           emoji: "⏱️", section: "Life" },
  { href: "/dashboard/journal",     label: "Journal",         emoji: "📝", section: "Life" },
  { href: "/dashboard/location",    label: "Location",        emoji: "📍", section: "Life" },
  { href: "/dashboard/reading",     label: "Reading",         emoji: "📚", section: "Life" },
  { href: "/dashboard/finances",    label: "Finances",        emoji: "💰", section: "Life" },
  { href: "/dashboard/bills",       label: "Bills",           emoji: "🧾", section: "Life" },
  { href: "/dashboard/subscriptions", label: "Subscriptions", emoji: "🔄", section: "Life" },
  { href: "/dashboard/gmail",       label: "Gmail",           emoji: "📬", section: "Life" },
  { href: "/dashboard/home",        label: "Home",            emoji: "🏡", section: "Life" },

  // The correlation engine's own page had no nav entry at all — it was
  // reachable only through a small link on a dashboard card.
  { href: "/dashboard/insights",    label: "Insights",        emoji: "🔍", section: "Patterns" },
  { href: "/dashboard/location-insights", label: "Place patterns", emoji: "🗺️", section: "Patterns" },
  { href: "/dashboard/custom",      label: "Custom metrics",  emoji: "🧮", section: "Patterns" },
  { href: "/dashboard/week",        label: "This Week",       emoji: "📅", section: "Patterns" },
  { href: "/dashboard/timeline",    label: "Timeline",        emoji: "🕐", section: "Patterns" },
  { href: "/dashboard/stats",       label: "Trends",          emoji: "💡", section: "Patterns" },
  { href: "/dashboard/streaks",     label: "Streaks",         emoji: "🔥", section: "Patterns" },
  { href: "/dashboard/lastfm",      label: "Last.fm",         emoji: "🎵", section: "Patterns" },
  { href: "/dashboard/rescuetime",  label: "RescueTime",      emoji: "⏱️", section: "Patterns" },

  { href: "/dashboard/settings",    label: "Settings",        emoji: "⚙️", section: "Life" },
]

const ALL_ITEMS = NAV_ITEMS.filter(i => isRouteEnabled(i.href))

const DEFAULT_ORDER = ALL_ITEMS.map(i => i.href)
const DEFAULT_HIDDEN = new Set([
  "/dashboard/week",
  "/dashboard/timeline",
  "/dashboard/stats",
  "/dashboard/streaks",
  "/dashboard/gmail",
  "/dashboard/reading",
  "/dashboard/lastfm",
  "/dashboard/rescuetime",
  "/dashboard/subscriptions",
  "/dashboard/home",
])
const NON_HIDEABLE = new Set(["/dashboard", "/dashboard/settings", "/dashboard/chat"])
// Pinned in the bottom nav, which exists below lg — repeating them in the
// drawer is pure duplication, so they only show where there's no bottom nav
// (lg+, incl. web layout mode, whose viewport is widened past lg).
// Still listed while customizing so they can be reordered.
const IN_BOTTOM_NAV = new Set([
  "/dashboard/chat",
  "/dashboard/checkin",
  "/dashboard/habits",
  "/dashboard/settings",
])
const LS_HIDDEN     = "sidebar-hidden-v2"
const LS_ORDER      = "sidebar-order-v1"
// Garden used to sit in DEFAULT_HIDDEN, and those defaults were persisted as
// if the user chose them — so removing it from the defaults never surfaced it
// for existing users. Strip it from stored prefs once; re-hiding afterwards
// sticks because the flag stays set.
const LS_GARDEN_MIGRATED = "sidebar-garden-unhidden-v1"
const GARDEN_HREF = "/dashboard/garden"
// Same problem, second time: pages launched after a user's preferences were
// saved stay hidden forever, because the old defaults were persisted as if
// they were choices. Strip these from stored prefs once — re-hiding sticks.
const LS_LAUNCH_MIGRATED = "sidebar-launch-unhidden-v1"
const NEWLY_LAUNCHED = ["/dashboard/insights", "/dashboard/fasting", "/dashboard/strava", "/dashboard/symptoms", "/dashboard/report"]

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

  // One display utility only — "hidden" and "flex" have equal specificity, so
  // combining them would leave the winner up to stylesheet order.
  const dup = !editing && IN_BOTTOM_NAV.has(item.href)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        dup ? "hidden lg:flex" : "flex",
        "items-center rounded-lg",
        isDragging && "opacity-40 z-50 bg-secondary/60",
      )}
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

export function Sidebar({ onClose, compact }: { onClose?: () => void; compact?: boolean }) {
  const pathname = usePathname()
  const [order,   setOrder]   = useState<string[]>(DEFAULT_ORDER)
  const [hidden,  setHidden]  = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState(false)
  const [bottomHovered, setBottomHovered] = useState(false)
  const [emergyState, setEmergyState] = useState<EmergyState>("okay")

  // The brand mark is Emergy himself — keep his colour in step with his
  // actual state, same polling as the bottom nav.
  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetch("/api/emergy")
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d?.state && !cancelled) setEmergyState(d.state) })
        .catch(() => {})
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    const gardenMigrated = localStorage.getItem(LS_GARDEN_MIGRATED) === "1"
    const launchMigrated = localStorage.getItem(LS_LAUNCH_MIGRATED) === "1"
    const migrated = gardenMigrated && launchMigrated
    // One pass for both migrations: drop anything that was only hidden because
    // it wasn't launched yet when these preferences were saved.
    const toUnhide = [
      ...(gardenMigrated ? [] : [GARDEN_HREF]),
      ...(launchMigrated ? [] : NEWLY_LAUNCHED),
    ]
    const stripGarden = (arr: string[]) => arr.filter(p => !toUnhide.includes(p))
    const needsStrip = (arr: string[]) => arr.some(p => toUnhide.includes(p))
    const markMigrated = () => {
      localStorage.setItem(LS_GARDEN_MIGRATED, "1")
      localStorage.setItem(LS_LAUNCH_MIGRATED, "1")
    }

    const lsH = localStorage.getItem(LS_HIDDEN)
    const lsO = localStorage.getItem(LS_ORDER)
    let localOrder: string[] = DEFAULT_ORDER
    if (lsO) try { localOrder = JSON.parse(lsO); setOrder(localOrder) } catch {}
    if (lsH) {
      try {
        let arr: string[] = JSON.parse(lsH)
        if (!migrated && needsStrip(arr)) {
          arr = stripGarden(arr)
          localStorage.setItem(LS_HIDDEN, JSON.stringify(arr))
        }
        setHidden(new Set(arr))
      } catch {}
    } else setHidden(new Set(DEFAULT_HIDDEN))

    fetch("/api/preferences/sidebar")
      .then(r => r.json())
      .then(d => {
        // Only override defaults if user has an explicit saved preference
        let serverHidden: string[] | null = Array.isArray(d.hidden) && d.hidden.length > 0 ? d.hidden : null
        const serverOrder: string[] | null = Array.isArray(d.order) && d.order.length > 0 ? d.order : null
        if (serverHidden && !migrated && needsStrip(serverHidden)) {
          serverHidden = stripGarden(serverHidden)
          fetch("/api/preferences/sidebar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order: serverOrder ?? localOrder, hidden: serverHidden }),
          })
            .then(markMigrated)
            .catch(() => {})
        } else {
          markMigrated()
        }
        if (serverHidden) {
          setHidden(new Set(serverHidden))
          localStorage.setItem(LS_HIDDEN, JSON.stringify(serverHidden))
        } else if (!lsH) {
          // No saved pref anywhere — persist the defaults so reset works correctly
          localStorage.setItem(LS_HIDDEN, JSON.stringify([...DEFAULT_HIDDEN]))
        }
        if (serverOrder) {
          setOrder(serverOrder)
          localStorage.setItem(LS_ORDER, JSON.stringify(serverOrder))
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

  // Section headers are only honest while the list is still in its default
  // order — after a manual reorder they'd label groups the user didn't make.
  const showSections = !editing &&
    order.length === DEFAULT_ORDER.length &&
    order.every((href, i) => href === DEFAULT_ORDER[i])

  // Respect stored order, append any new items not yet saved
  const orderedItems = [
    ...order.map(href => ALL_ITEMS.find(i => i.href === href)).filter(Boolean) as NavItem[],
    ...ALL_ITEMS.filter(i => !order.includes(i.href)),
  ]
  const displayItems = editing ? orderedItems : orderedItems.filter(i => !hidden.has(i.href))

  if (compact) {
    return (
      <aside
        className="w-14 shrink-0 h-full flex flex-col border-r border-border"
        style={{
          background: "linear-gradient(180deg, var(--sidebar-from) 0%, var(--sidebar-to) 100%)",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Logo icon — the 3D Emergy mark */}
        <div className="flex items-center justify-center h-14 border-b border-border/60">
          <div className="relative shrink-0 w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center">
            <EmergyAvatar mood={emergyState} fit="icon" size={24} />
          </div>
        </div>

        {/* Nav — icons only */}
        <nav className="flex-1 py-2 overflow-y-auto scrollbar-none flex flex-col items-center gap-0.5">
          {displayItems.map(item => {
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  IN_BOTTOM_NAV.has(item.href) ? "hidden lg:flex" : "flex",
                  "items-center justify-center w-9 h-9 rounded-lg text-base transition-all",
                  active
                    ? "bg-primary/20 border border-primary/25"
                    : "text-muted-foreground hover:bg-secondary/60"
                )}
              >
                {item.emoji}
              </Link>
            )
          })}
        </nav>

        {/* Sign out */}
        <div className="p-2 border-t border-border/60 flex justify-center">
          <button
            onClick={() => signOut({ callbackUrl: "/signin" })}
            title="Sign out"
            className="flex items-center justify-center w-9 h-9 rounded-lg text-base text-muted-foreground hover:bg-secondary/60 transition-all"
          >
            👋
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside
      className="w-56 shrink-0 h-full flex flex-col border-r border-border"
      style={{
        background: "linear-gradient(180deg, var(--sidebar-from) 0%, var(--sidebar-to) 100%)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Logo — the 3D Emergy mark, live to his state */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-border/60">
        <div className="relative shrink-0 w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center">
          <EmergyAvatar mood={emergyState} fit="icon" size={24} />
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
              {displayItems.map((item, i) => (
                <div key={item.href}>
                  {showSections && item.section !== displayItems[i - 1]?.section && (
                    <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                      {item.section}
                    </p>
                  )}
                  <SortableItem
                    item={item}
                    active={pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))}
                    isHidden={hidden.has(item.href)}
                    editing={editing}
                    onToggleHidden={() => toggleHidden(item.href)}
                    onClose={onClose}
                  />
                </div>
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
          // Hidden until hover on a mouse, always visible on touch. It was
          // hover-only everywhere, so on a phone — where this sidebar is a
          // drawer and there is no hover — the one control that lets someone
          // reorder and hide nav items was invisible. The app could be
          // personalised the whole time; you just couldn't find the door.
          <div className={cn(
            "transition-opacity duration-150 opacity-100 [@media(hover:hover)]:opacity-0",
            bottomHovered && "[@media(hover:hover)]:opacity-100",
          )}>
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
