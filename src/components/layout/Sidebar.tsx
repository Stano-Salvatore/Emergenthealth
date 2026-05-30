"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { X, Settings2, Eye, EyeOff, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useEffect, useRef } from "react"

type NavItem = { href: string; label: string; emoji: string }

const navGroups: { label: string; emoji: string; color: string; items: NavItem[] }[] = [
  {
    label: "Dashboard",
    emoji: "📊",
    color: "text-indigo-400",
    items: [
      { href: "/dashboard",       label: "Overview",   emoji: "🏠" },
      { href: "/dashboard/week",  label: "This Week",  emoji: "📅" },
      { href: "/dashboard/timeline", label: "Timeline", emoji: "🕐" },
      { href: "/dashboard/stats",    label: "Insights",  emoji: "💡" },
      { href: "/dashboard/streaks", label: "Streaks",   emoji: "🔥" },
    ],
  },
  {
    label: "Health",
    emoji: "🌿",
    color: "text-green-400",
    items: [
      { href: "/dashboard/checkin",       label: "Check-in",     emoji: "🌅" },
      { href: "/dashboard/health",       label: "Health",       emoji: "❤️" },
      { href: "/dashboard/weight",       label: "Weight",       emoji: "⚖️" },
      { href: "/dashboard/habits",       label: "Habits",       emoji: "✅" },
      { href: "/dashboard/medications",  label: "Medications",  emoji: "💊" },
      { href: "/dashboard/intake",       label: "Intake",       emoji: "🥤" },
      { href: "/dashboard/focus",        label: "Focus",        emoji: "🎯" },
      { href: "/dashboard/custom",       label: "Trackers",     emoji: "📐" },
      { href: "/dashboard/reading",      label: "Reading",      emoji: "📚" },
      { href: "/dashboard/journal",      label: "Journal",      emoji: "📝" },
    ],
  },
  {
    label: "Life",
    emoji: "✨",
    color: "text-amber-400",
    items: [
      { href: "/dashboard/finances",      label: "Finances",      emoji: "💰" },
      { href: "/dashboard/subscriptions", label: "Subscriptions", emoji: "🔄" },
      { href: "/dashboard/bills",         label: "Bills",         emoji: "🧾" },
      { href: "/dashboard/calendar",      label: "Calendar",      emoji: "🗓️" },
      { href: "/dashboard/reminders",     label: "Reminders",     emoji: "🔔" },
      { href: "/dashboard/gmail",         label: "Gmail",         emoji: "📬" },
      { href: "/dashboard/location",      label: "Location",      emoji: "📍" },
      { href: "/dashboard/home",          label: "Home",          emoji: "🏡" },
    ],
  },
  {
    label: "Tools",
    emoji: "🔧",
    color: "text-violet-400",
    items: [
      { href: "/dashboard/chat",     label: "Emergy",    emoji: "🌱" },
      { href: "/dashboard/settings", label: "Settings",  emoji: "⚙️" },
    ],
  },
]

const NON_HIDEABLE = new Set(["/dashboard", "/dashboard/settings", "/dashboard/chat"])

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const [hidden, setHidden] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const cached = localStorage.getItem("sidebar-hidden-v1")
    if (cached) {
      try { setHidden(JSON.parse(cached)) } catch {}
    }
    fetch("/api/preferences/sidebar")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.hidden)) {
          setHidden(data.hidden)
          localStorage.setItem("sidebar-hidden-v1", JSON.stringify(data.hidden))
        }
      })
      .catch(() => {})
  }, [])

  function persistHidden(next: string[]) {
    localStorage.setItem("sidebar-hidden-v1", JSON.stringify(next))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetch("/api/preferences/sidebar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: next }),
      }).catch(() => {})
    }, 800)
  }

  function toggleHidden(href: string) {
    if (NON_HIDEABLE.has(href)) return
    const next = hidden.includes(href)
      ? hidden.filter(h => h !== href)
      : [...hidden, href]
    setHidden(next)
    persistHidden(next)
  }

  function resetHidden() {
    setHidden([])
    persistHidden([])
  }

  return (
    <aside
      className="w-56 shrink-0 h-screen flex flex-col border-r border-border"
      style={{ background: "linear-gradient(180deg, var(--sidebar-from) 0%, var(--sidebar-to) 100%)" }}
    >
      {/* ── Logo ── */}
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
            className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 p-3 overflow-y-auto space-y-5 scrollbar-thin">
        {navGroups.map(group => {
          const visibleItems = editing
            ? group.items
            : group.items.filter(item => !hidden.includes(item.href))
          if (!editing && visibleItems.length === 0) return null
          return (
            <div key={group.label}>
              <p className={cn("text-[9px] font-bold uppercase tracking-[0.12em] px-3 mb-2 flex items-center gap-1", group.color, "opacity-70")}>
                <span>{group.emoji}</span>
                {group.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map(({ href, label, emoji }) => {
                  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
                  const isHidden = hidden.includes(href)
                  const isHideable = !NON_HIDEABLE.has(href)
                  const isHovered = hoveredItem === href
                  return (
                    <div
                      key={href}
                      className="relative group/item"
                      onMouseEnter={() => setHoveredItem(href)}
                      onMouseLeave={() => setHoveredItem(null)}
                    >
                      <Link
                        href={href}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150",
                          active
                            ? "bg-gradient-to-r from-primary/20 to-primary/5 text-primary font-semibold border border-primary/25 shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-white/5",
                          editing && isHidden && "opacity-40",
                        )}
                      >
                        <span className="text-base leading-none w-5 text-center shrink-0" role="img">{emoji}</span>
                        <span className={cn(editing && isHidden && "line-through")}>{label}</span>
                      </Link>
                      {editing && isHideable && isHovered && (
                        <button
                          onClick={() => toggleHidden(href)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={isHidden ? "Show item" : "Hide item"}
                        >
                          {isHidden
                            ? <EyeOff className="h-3.5 w-3.5" />
                            : <Eye className="h-3.5 w-3.5" />
                          }
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* ── Bottom area ── */}
      <div className="p-3 border-t border-border/60 space-y-0.5">
        {editing ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Done
            </button>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <button
              onClick={resetHidden}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => {
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))
              }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all duration-150"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Quick nav</span>
              <kbd className="text-[9px] font-mono bg-secondary rounded px-1 py-0.5">⌘K</kbd>
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all duration-150"
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              Customize
            </button>
          </>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/signin" })}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full text-red-400/70 hover:text-red-400 hover:bg-red-400/5 transition-all duration-150"
        >
          <span className="text-base leading-none w-5 text-center shrink-0">👋</span>
          Sign out
        </button>
      </div>
    </aside>
  )
}
