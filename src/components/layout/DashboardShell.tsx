"use client"

import { useState, useEffect } from "react"
import { Menu } from "lucide-react"
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

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    // On wide screens always default open; on narrow respect saved preference
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
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile backdrop — only on narrow screens */}
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
      <main className="flex-1 overflow-y-auto min-w-0 relative">
        {/* Hamburger — visible when sidebar is closed */}
        <button
          onClick={toggle}
          aria-label="Open sidebar"
          className={cn(
            "fixed top-3 left-3 z-10 h-8 w-8 rounded-lg",
            "bg-background/90 border border-border shadow-sm",
            "flex items-center justify-center",
            "transition-all duration-300",
            open ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"
          )}
        >
          <Menu className="h-4 w-4 text-muted-foreground" />
        </button>

        <div className={cn("p-6 pb-24 lg:pb-6 transition-[padding] duration-300", !open && "lg:pl-6 pl-14")}>
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
