"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Sun, CheckSquare, DollarSign, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { isFeatureEnabled } from "@/lib/features"
import { EmergyAvatar } from "@/components/emergy/EmergyAvatar"
import { useEmergyState } from "@/lib/emergy-store"

type Tab = {
  href: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

// Emergy sits in the middle as the live mascot (see below); two tabs each side.
const leftTabs: Tab[] = [
  { href: "/dashboard",          label: "Home",      Icon: Home,        exact: true },
  isFeatureEnabled("finances")
    ? { href: "/dashboard/finances", label: "Finances", Icon: DollarSign }
    : { href: "/dashboard/checkin",  label: "Check-in", Icon: Sun },
]
const rightTabs: Tab[] = [
  { href: "/dashboard/habits",   label: "Habits",    Icon: CheckSquare },
  { href: "/dashboard/settings", label: "Settings",  Icon: Settings },
]

function NavTab({ href, label, Icon, exact }: Tab) {
  const pathname = usePathname()
  const active = exact ? pathname === href : pathname.startsWith(href)
  return (
    <Link href={href} className="flex flex-col items-center gap-0.5 flex-1 min-w-0 relative">
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
}

export function BottomNav() {
  const pathname = usePathname()
  // Shared with every other Emergy on the page — see lib/emergy-store.
  const emergyState = useEmergyState()
  const chatActive = pathname.startsWith("/dashboard/chat")

  const needsAttention = emergyState === "screaming" || emergyState === "wilting"

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="bg-background/95 backdrop-blur-md border-t border-border flex items-end px-1 py-1.5">
        {leftTabs.map(t => <NavTab key={t.href} {...t} />)}

        {/* Emergy — the mascot itself, raised in the centre */}
        <Link
          href="/dashboard/chat"
          className="flex flex-col items-center flex-1 min-w-0 relative -mt-6"
          aria-label="Emergy"
        >
          <div className={cn(
            "flex items-center justify-center h-14 w-14 rounded-full border bg-background shadow-lg transition-all duration-200",
            chatActive ? "border-primary/50 shadow-primary/20" : "border-border shadow-black/30"
          )}>
            <EmergyAvatar mood={emergyState} fit="icon" size={46} />
            {needsAttention && !chatActive && (
              <span className="absolute top-0.5 right-2.5 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
          <span className={cn(
            "text-[10px] font-medium truncate transition-colors duration-200 mt-0.5",
            chatActive ? "text-primary" : "text-muted-foreground"
          )}>
            Emergy
          </span>
        </Link>

        {rightTabs.map(t => <NavTab key={t.href} {...t} />)}
      </div>
    </nav>
  )
}
