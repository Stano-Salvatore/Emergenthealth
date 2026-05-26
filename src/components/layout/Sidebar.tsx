"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"

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
      { href: "/dashboard/chat",     label: "Claude AI", emoji: "🤖" },
      { href: "/dashboard/settings", label: "Settings",  emoji: "⚙️" },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()

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
        <span className="font-bold text-sm text-gradient">Emergenthealth</span>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 p-3 overflow-y-auto space-y-5 scrollbar-thin">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className={cn("text-[9px] font-bold uppercase tracking-[0.12em] px-3 mb-2 flex items-center gap-1", group.color, "opacity-70")}>
              <span>{group.emoji}</span>
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ href, label, emoji }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150",
                      active
                        ? "bg-gradient-to-r from-primary/20 to-primary/5 text-primary font-semibold border border-primary/25 shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <span className="text-base leading-none w-5 text-center shrink-0" role="img">{emoji}</span>
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Sign out ── */}
      <div className="p-3 border-t border-border/60">
        <button
          onClick={() => signOut({ callbackUrl: "/signin" })}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all duration-150"
        >
          <span className="text-base leading-none w-5 text-center shrink-0">👋</span>
          Sign out
        </button>
      </div>
    </aside>
  )
}
