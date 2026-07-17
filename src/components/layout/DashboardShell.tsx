"use client"

import { useState, useEffect } from "react"
import { Menu } from "lucide-react"
import { Sidebar } from "./Sidebar"
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
  const [webMode, setWebMode] = useState(false)

  useEffect(() => {
    // Display scale itself is rendered server-side (see generateViewport() in
    // app/layout.tsx) from a cookie — nothing to apply client-side here. Doing
    // so on every mount (including SPA navigations between dashboard pages)
    // used to risk re-mutating the viewport meta with a stale value after the
    // correct one was already set at first load.
    let layoutMode = localStorage.getItem("layout_mode")

    // layout_mode (and display_zoom) live only in localStorage/cookies, which
    // are per-device by nature — switching to Web mode on a phone never
    // affects a tablet or any other device. But a device that's never set a
    // preference of its own defaulted to "mobile" regardless of its actual
    // screen size, which looks needlessly cramped on a tablet that already
    // has plenty of room. On first-ever load for a device, auto-pick based on
    // its real (un-zoomed, since no zoom cookie exists yet either) width:
    // tablet-or-larger gets Web mode's always-visible sidebar at normal 100%
    // zoom (no need to shrink anything — that trick is for small phones);
    // phone-sized stays "mobile" as before.
    if (layoutMode !== "web" && layoutMode !== "mobile") {
      layoutMode = window.innerWidth >= 768 ? "web" : "mobile"
      try { localStorage.setItem("layout_mode", layoutMode) } catch { /* */ }
    }
    const isWeb = layoutMode === "web"
    setWebMode(isWeb)

    const saved = localStorage.getItem(STORAGE_KEY)
    const wide = window.innerWidth >= 1024
    const defaultOpen = isWeb ? true : wide ? (saved !== "false") : (saved === "true")
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
      <main
        className="flex-1 overflow-y-auto p-6"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >{children}</main>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile backdrop — only in mobile mode when sidebar is open */}
      {open && !webMode && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 lg:hidden"
          onClick={toggle}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "transition-[width,transform] duration-300 ease-in-out",
          webMode
            ? cn(
                "relative shrink-0 h-full",
                open ? "w-56" : "w-0 overflow-hidden"
              )
            : cn(
                "fixed top-0 left-0 z-30 h-full",
                "lg:relative lg:z-auto lg:shrink-0",
                "w-[75vw] max-w-[224px] lg:w-56",
                open
                  ? "translate-x-0"
                  : "-translate-x-full lg:translate-x-0 lg:w-0 lg:overflow-hidden"
              )
        )}
      >
        <Sidebar onClose={toggle} />
      </div>

      {/* Main content */}
      <main
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 relative"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Hamburger — visible when sidebar is closed. Offset below the status
            bar so it never sits under the Android clock/wifi icons. */}
        <button
          onClick={toggle}
          aria-label="Open sidebar"
          style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
          className={cn(
            "fixed left-3 z-10 h-8 w-8 rounded-lg",
            "bg-background/90 border border-border shadow-sm",
            "flex items-center justify-center",
            "transition-all duration-300",
            open ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"
          )}
        >
          <Menu className="h-4 w-4 text-muted-foreground" />
        </button>

        <div className={cn(
          "transition-[padding] duration-300",
          webMode ? "p-6" : cn("p-3 lg:p-6", !open && "lg:pl-6 pl-12")
        )}>
          {webMode ? (
            // Web mode zooms out to a much wider layout viewport than any
            // real screen, so raw content left to stretch edge-to-edge looks
            // arbitrary and off-center. The outer p-6 above gives an EQUAL gap
            // on every side (left included, flush against the sidebar
            // otherwise) before the panel itself; max-w + mx-auto only kick in
            // as an extra cap on very wide viewports. Border is a solid accent
            // color (not a low-contrast neutral) so the boundary actually reads.
            <div className="max-w-[1400px] mx-auto rounded-2xl border-[3px] border-primary bg-card p-6 shadow-2xl shadow-primary/10">
              {children}
            </div>
          ) : children}
        </div>
      </main>

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
