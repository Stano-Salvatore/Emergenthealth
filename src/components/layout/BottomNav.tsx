"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, CupSoda, CheckSquare, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { EmergyAvatar } from "@/components/emergy/EmergyAvatar"
import { useEmergyState } from "@/lib/emergy-store"

type Tab = {
  href: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

// Emergy sits in the middle as the live mascot (see below); two tabs each side.
//
// Four slots for forty destinations, so they go to what you do OFTEN, not to
// what matters most. Check-in held this one and is a once-a-day wizard; logging
// a drink happens all day and had no front door at all — it was four taps and
// two scrolls behind the hamburger, or the very bottom of a five-screen Home.
//
// Straight to the chips, not to the tab that greets you: /dashboard/intake
// opens on a read-only summary, which is a fine page and the wrong one to land
// on when you came to record a coffee.
const leftTabs: Tab[] = [
  { href: "/dashboard",                    label: "Home", Icon: Home, exact: true },
  { href: "/dashboard/intake?tab=intake",  label: "Log",  Icon: CupSoda },
]
const rightTabs: Tab[] = [
  { href: "/dashboard/habits",   label: "Habits",    Icon: CheckSquare },
  { href: "/dashboard/settings", label: "Settings",  Icon: Settings },
]

function NavTab({ href, label, Icon, exact }: Tab) {
  const pathname = usePathname()
  // A tab may point at a query (Log opens Intake on its logging tab) and
  // usePathname never carries one — matched on the path alone, or the tab
  // simply never lights up on the page it just opened.
  const path = href.split("?")[0]
  const active = exact ? pathname === path : pathname === path || pathname.startsWith(path + "/")
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
              // data-pulse: a deliberate attention badge, not a loading
              // skeleton. The smoke check treats an undeclared pulse as a
              // screen stuck loading, and it was right to.
              <span
                data-pulse="attention"
                aria-label="Emergy has something for you"
                className="absolute top-0.5 right-2.5 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"
              />
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
