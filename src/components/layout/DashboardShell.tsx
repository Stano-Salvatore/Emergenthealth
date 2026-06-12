"use client"

import { useState, useEffect } from "react"
import { Menu, PanelLeftClose, PanelLeft } from "lucide-react"
import { usePathname } from "next/navigation"
import { Sidebar } from "./Sidebar"
import { BottomNav } from "./BottomNav"
import { CommandPalette } from "./CommandPalette"
import { WhatsNewBanner } from "./WhatsNewBanner"
import { FeedbackButton } from "@/components/dashboard/FeedbackButton"
import { InstallPrompt } from "./InstallPrompt"
import { AppSharePrompt } from "./AppSharePrompt"
import { TrialBanner } from "./TrialBanner"
import { OfflineToast } from "./OfflineToast"
import { RateAppPrompt } from "./RateAppPrompt"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "sidebar-open"

function usePageTitle(pathname: string) {
  const segments: Record<string, string> = {
    "/dashboard":              "Prehľad",
    "/dashboard/week":         "Tento týždeň",
    "/dashboard/timeline":     "Časová os",
    "/dashboard/stats":        "Insights",
    "/dashboard/streaks":      "Streaks",
    "/dashboard/checkin":      "Check-in",
    "/dashboard/habits":       "Návyky",
    "/dashboard/medications":  "Lieky",
    "/dashboard/intake":       "Príjem",
    "/dashboard/journal":      "Denník",
    "/dashboard/focus":        "Focus",
    "/dashboard/fasting":      "Pôst",
    "/dashboard/caffeine":     "Kofeín",
    "/dashboard/health":       "Zdravie",
    "/dashboard/insights":     "Korelácie",
    "/dashboard/weight":       "Hmotnosť",
    "/dashboard/body":         "Telo",
    "/dashboard/custom":       "Trackery",
    "/dashboard/reading":      "Čítanie",
    "/dashboard/labs":         "Výsledky",
    "/dashboard/finances":     "Financie",
    "/dashboard/subscriptions":"Predplatné",
    "/dashboard/bills":        "Účty",
    "/dashboard/calendar":     "Kalendár",
    "/dashboard/reminders":    "Pripomienky",
    "/dashboard/gmail":        "Gmail",
    "/dashboard/location":     "Poloha",
    "/dashboard/home":         "Domácnosť",
    "/dashboard/strava":       "Strava",
    "/dashboard/lastfm":       "Last.fm",
    "/dashboard/rescuetime":   "RescueTime",
    "/dashboard/chat":         "Emergy",
    "/dashboard/server":       "Cluster Matrix",
    "/dashboard/garden":       "Záhrada",
    "/dashboard/settings":     "Nastavenia",
  }
  return segments[pathname] ?? "Gemmi"
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()
  const pageTitle = usePageTitle(pathname)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    const wide = window.innerWidth >= 1024
    const defaultOpen = wide ? (saved !== "false") : (saved === "true")
    setOpen(defaultOpen)
    setMounted(true)
  }, [])

  const toggle = () =>
    setOpen(o => {
      localStorage.setItem(STORAGE_KEY, String(!o))
      return !o
    })

  if (!mounted) return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="w-56 shrink-0" />
      <main className="flex-1 overflow-y-auto">
        <div className="hidden lg:flex h-12 items-center border-b border-border/40 px-6" />
        <div className="p-6">{children}</div>
      </main>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 lg:hidden"
          onClick={toggle}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed top-0 left-0 z-30 h-full",
          "lg:relative lg:z-auto lg:shrink-0",
          "transition-[width,transform] duration-300 ease-in-out",
          open
            ? "translate-x-0 w-56"
            : "-translate-x-full w-56 lg:translate-x-0 lg:w-0 lg:overflow-hidden"
        )}
      >
        <Sidebar onClose={toggle} />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-w-0 flex flex-col">

        {/* Desktop top bar */}
        <header className="hidden lg:flex h-12 shrink-0 items-center gap-3 border-b border-border/40 px-4 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
          <button
            onClick={toggle}
            aria-label="Toggle sidebar"
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            {open
              ? <PanelLeftClose className="h-4 w-4" />
              : <PanelLeft      className="h-4 w-4" />
            }
          </button>
          <div className="h-4 w-px bg-border/60" />
          <span className="text-sm font-medium text-foreground/80">{pageTitle}</span>
        </header>

        {/* Mobile hamburger */}
        <button
          onClick={toggle}
          aria-label="Open sidebar"
          className={cn(
            "fixed top-3 left-3 z-10 h-8 w-8 rounded-lg lg:hidden",
            "bg-background/90 border border-border shadow-sm",
            "flex items-center justify-center",
            "transition-all duration-300",
            open ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"
          )}
        >
          <Menu className="h-4 w-4 text-muted-foreground" />
        </button>

        <div className={cn(
          "flex-1 p-4 pb-24 lg:p-6 lg:pb-6 transition-[padding] duration-300",
          !open && "lg:pl-6 pl-14",
          "max-w-screen-2xl w-full mx-auto"
        )}>
          {children}
        </div>
      </main>

      <BottomNav />
      <FeedbackButton />
      <InstallPrompt />
      <AppSharePrompt />
      <CommandPalette />
      <WhatsNewBanner />
      <TrialBanner />
      <OfflineToast />
      <RateAppPrompt />
    </div>
  )
}
