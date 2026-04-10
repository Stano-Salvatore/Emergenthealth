"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
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
} from "lucide-react"

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/health", label: "Health", icon: Activity },
  { href: "/dashboard/finances", label: "Finances", icon: DollarSign },
  { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
  { href: "/dashboard/habits", label: "Habits", icon: CheckSquare },
  { href: "/dashboard/reminders", label: "Reminders", icon: Bell },
  { href: "/dashboard/home", label: "Home", icon: Home },
  { href: "/dashboard/chat", label: "Claude AI", icon: MessageSquare },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 h-screen flex flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <Activity className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm">Emergenthealth</span>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
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
      </nav>
    </aside>
  )
}
