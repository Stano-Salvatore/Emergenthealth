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
  Droplets,
  Timer,
  BarChart3,
  CalendarDays,
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
      { href: "/dashboard/intake", label: "Intake", icon: Droplets },
      { href: "/dashboard/focus", label: "Focus", icon: Timer },
      { href: "/dashboard/journal", label: "Journal", icon: BookOpen },
    ],
  },
  {
    label: "Life",
    items: [
      { href: "/dashboard/finances", label: "Finances", icon: DollarSign },
      { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
      { href: "/dashboard/reminders", label: "Reminders", icon: Bell },
      { href: "/dashboard/gmail", label: "Gmail", icon: Mail },
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
    <aside className="w-56 shrink-0 h-screen flex flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <Activity className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm">Emergenthealth</span>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto space-y-4">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-3 mb-1">
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
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-border">
        <button
          onClick={() => signOut({ callbackUrl: "/signin" })}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
