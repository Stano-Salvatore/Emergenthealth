"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import {
  Activity,
  DollarSign,
  Calendar,
  CheckSquare,
  Bell,
  MessageSquare,
  LayoutDashboard,
  Home,
  Settings,
  LogOut,
  Mail,
  BookOpen,
  Library,
  Droplets,
  Timer,
  BarChart3,
  CalendarDays,
  MapPin,
  Repeat,
  Pill,
  Receipt,
} from "lucide-react"

type NavItem = { href: string; label: string; icon: React.ElementType }

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Dashboard",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/week", label: "This Week", icon: CalendarDays },
      { href: "/dashboard/stats", label: "Insights", icon: BarChart3 },
    ],
  },
  {
    label: "Health",
    items: [
      { href: "/dashboard/health", label: "Health", icon: Activity },
      { href: "/dashboard/habits", label: "Habits", icon: CheckSquare },
      { href: "/dashboard/medications", label: "Medications", icon: Pill },
      { href: "/dashboard/intake", label: "Intake", icon: Droplets },
      { href: "/dashboard/focus", label: "Focus", icon: Timer },
      { href: "/dashboard/reading", label: "Reading", icon: Library },
      { href: "/dashboard/journal", label: "Journal", icon: BookOpen },
    ],
  },
  {
    label: "Life",
    items: [
      { href: "/dashboard/finances", label: "Finances", icon: DollarSign },
      { href: "/dashboard/subscriptions", label: "Subscriptions", icon: Repeat },
      { href: "/dashboard/bills", label: "Bills", icon: Receipt },
      { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
      { href: "/dashboard/reminders", label: "Reminders", icon: Bell },
      { href: "/dashboard/gmail", label: "Gmail", icon: Mail },
      { href: "/dashboard/location", label: "Location", icon: MapPin },
      { href: "/dashboard/home", label: "Home", icon: Home },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/dashboard/chat", label: "Claude AI", icon: MessageSquare },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
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
          <div className="relative bg-gradient-to-br from-primary to-violet-600 rounded-lg p-1.5">
            <Activity className="h-3.5 w-3.5 text-white" />
          </div>
        </div>
        <span className="font-bold text-sm text-gradient">Emergenthealth</span>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 p-3 overflow-y-auto space-y-5 scrollbar-thin">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/40 px-3 mb-2">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150",
                      active
                        ? "bg-gradient-to-r from-primary/20 to-primary/5 text-primary font-semibold border border-primary/25 shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-primary" : "")} />
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
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-150"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
