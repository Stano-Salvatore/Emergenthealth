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
  { href: "/dashboard",          label: "Home",      Icon: Home,        exact: true },
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
      <div className="bg-background/95 backdrop-blur-md border-t border-border flex items-center px-1 py-1.5">
        {tabs.map(({ href, label, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-0.5 flex-1 min-w-0 relative"
            >
              <div className={cn(
                "flex items-center justify-center w-12 h-8 rounded-full transition-all duration-200",
                active ? "bg-primary/15" : "bg-transparent"
              )}>
                <Icon className={cn(
                  "transition-all duration-200",
                  active ? "h-5 w-5 text-primary" : "h-5 w-5 text-muted-foreground"
                )} />
              </div>
              <span className={cn(
                "text-[10px] font-medium truncate transition-colors duration-200",
                active ? "text-primary" : "text-muted-foreground"
              )}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
