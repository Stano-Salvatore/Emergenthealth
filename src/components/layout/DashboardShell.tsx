"use client"

import { useEffect, useRef } from "react"
import { Menu } from "lucide-react"
import { Sidebar } from "./Sidebar"
import { CommandPalette } from "./CommandPalette"
import { WhatsNewBanner } from "./WhatsNewBanner"
import { InstallPrompt } from "./InstallPrompt"
import { AppSharePrompt } from "./AppSharePrompt"
import { TrialBanner } from "./TrialBanner"
import { OfflineToast } from "./OfflineToast"
import { RateAppPrompt } from "./RateAppPrompt"
import { BottomNav } from "./BottomNav"
import { cn } from "@/lib/utils"
import { resumeBackgroundLocation } from "@/lib/native/background-location"
import { readLocalString, useClientValue, useLocalSetting } from "@/lib/use-client-value"

const STORAGE_KEY = "sidebar-open"

// layout_mode (and display_zoom) live only in localStorage/cookies, which are
// per-device by nature — switching to Web mode on a phone never affects a
// tablet. A device that has never set a preference used to default to "mobile"
// regardless of its actual screen size, which looks needlessly cramped on a
// tablet with room to spare, so an unset device is sized by its width instead.
function resolveLayoutMode(): "web" | "mobile" {
  const saved = readLocalString("layout_mode", "")
  if (saved === "web" || saved === "mobile") return saved
  return window.innerWidth >= 768 ? "web" : "mobile"
}

function defaultSidebarOpen(): boolean {
  if (resolveLayoutMode() === "web") return true
  const saved = readLocalString(STORAGE_KEY, "")
  // A wide screen keeps the sidebar unless it was explicitly closed; a narrow
  // one keeps it closed unless it was explicitly opened.
  return window.innerWidth >= 1024 ? saved !== "false" : saved === "true"
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  // All three come from localStorage and the window size — things the server
  // cannot see. Reading them without an effect means the first client paint is
  // already the right layout instead of a mobile-shaped flash.
  const mounted = useClientValue(() => true, false)
  const webMode = useClientValue(() => resolveLayoutMode() === "web", false)
  const [open, setOpen] = useLocalSetting(defaultSidebarOpen, true)

  // Android drops the foreground service on reboot and forbids starting one
  // from the background, so the app opening is the only moment tracking can
  // come back. Here rather than the root layout because the upload needs a
  // session, and the sign-in page has none.
  useEffect(() => { void resumeBackgroundLocation() }, [])

  // Write the width-derived choice down the first time, so it stays put if the
  // window is later resized. Display scale itself is rendered server-side (see
  // generateViewport() in app/layout.tsx) from a cookie — nothing to apply
  // client-side here, and doing so on every mount (including SPA navigations
  // between dashboard pages) used to risk re-mutating the viewport meta with a
  // stale value after the correct one was already set at first load.
  useEffect(() => {
    const saved = readLocalString("layout_mode", "")
    if (saved !== "web" && saved !== "mobile") {
      try { localStorage.setItem("layout_mode", resolveLayoutMode()) } catch { /* */ }
    }
  }, [])

  // Swipe from the left edge to open the drawer, swipe left to close it.
  //
  // Edge-only on purpose: this app has horizontal scrollers in it — the week
  // table, the garden's card strip, the report's tables — and a gesture that
  // started anywhere would fight them for every drag. Twenty-four pixels is
  // narrower than any of them begin.
  const touch = useRef<{ x: number; y: number; live: boolean } | null>(null)

  const toggle = () => {
    const next = !open
    try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* */ }
    setOpen(next)
  }

  if (!mounted) return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <div className="w-56 shrink-0" />
      <main
        className="flex-1 overflow-y-auto p-6"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >{children}</main>
    </div>
  )

  function onTouchStart(e: React.TouchEvent) {
    if (webMode) return
    const t = e.touches[0]
    if (!t) return
    // Closed: only the edge starts a drag. Open: anywhere can close it.
    touch.current = { x: t.clientX, y: t.clientY, live: open || t.clientX <= 24 }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current
    touch.current = null
    if (!start?.live) return
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // A drag that moved further up or down than sideways was a scroll.
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return
    if (!open && dx > 0) toggle()
    if (open && dx < 0) toggle()
  }

  return (
    <div
      className="flex h-[100dvh] overflow-hidden bg-background"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
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
          // Extra bottom padding on mobile so content clears the fixed bottom
          // tab bar (hidden at lg and in web mode).
          // The hamburger floats at the top-left. Reserving a 48px column
          // down the WHOLE page to clear a 32px button at the top of it cost
          // 12% of a 390px screen on every screen; clearing it vertically
          // costs one row, once. Horizontal space is the scarce one on a
          // phone.
          webMode ? "p-6" : cn("p-3 lg:p-6 pb-20 lg:pb-6", !open && "lg:pt-6 lg:pl-6 pt-12")
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

      {/* Bottom tab bar — mobile only (lg:hidden), and hidden in web mode where
          the sidebar is always visible. */}
      {!webMode && <BottomNav />}

      {/* The floating "Suggest" feedback button used to live here, but it sat
          in the same corner as the Emergy bubble and ended up behind it. */}
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
