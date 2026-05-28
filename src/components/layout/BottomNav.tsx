"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Sun, CheckSquare, DollarSign, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

type Tab = {
  href: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

const tabs: Tab[] = [
  { href: "/dashboard",          label: "Overview",  Icon: Home,        exact: true },
  { href: "/dashboard/checkin",  label: "Check-in",  Icon: Sun },
  { href: "/dashboard/habits",   label: "Habits",    Icon: CheckSquare },
  { href: "/dashboard/finances", label: "Finances",  Icon: DollarSign },
  { href: "/dashboard/settings", label: "Settings",  Icon: Settings },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="bg-background/95 backdrop-blur-md border-t border-border flex items-center justify-around px-2 py-1">
        {tabs.map(({ href, label, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors min-w-0 flex-1",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="text-[10px] font-medium truncate">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
