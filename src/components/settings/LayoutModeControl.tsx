"use client"

import { useState, useEffect } from "react"
import { persistDisplayScale } from "@/lib/display-scale"

export type LayoutMode = "mobile" | "web"

export function LayoutModeControl() {
  const [mode, setMode] = useState<LayoutMode>("mobile")

  useEffect(() => {
    try {
      const saved = localStorage.getItem("layout_mode") as LayoutMode | null
      if (saved === "web" || saved === "mobile") setMode(saved)
    } catch {}
  }, [])

  function apply(v: LayoutMode) {
    setMode(v)
    try {
      localStorage.setItem("layout_mode", v)
    } catch {}
    // Use the *physical* device width, not window.innerWidth: innerWidth is the
    // layout viewport, which is already wide when we're currently in Web mode —
    // reading it there would compute zoom≈1 and fail to shrink on a re-toggle.
    // screen.width is stable regardless of the active zoom.
    const deviceWidth = Math.round(window.screen?.width || window.innerWidth || 400)
    // Only shrink to fit on a small screen — that trick is for squeezing a
    // desktop-style layout onto a phone. A tablet/desktop-sized screen already
    // has room to spare, so Web mode there stays at native 100% zoom.
    const isSmallScreen = deviceWidth < 768
    // Render the app at a real desktop-ish width (WEB_TARGET_WIDTH) and let the
    // server-rendered viewport scale it to fit the screen. The old value hard-
    // coded a 0.25 scale (25%) — so extreme that WebView wouldn't reliably
    // honour it (the layout rendered too large and ~20% ran off the right edge)
    // and, where it did apply, the text was microscopic. Targeting ~1024px CSS
    // gives a genuine, readable "web view" that fits the screen edge-to-edge.
    const WEB_TARGET_WIDTH = 1024
    const zoom = Math.min(1, deviceWidth / WEB_TARGET_WIDTH)
    // persistDisplayScale reloads — the server then renders the correct
    // viewport <meta> from the cookie it sets (see src/lib/display-scale.ts).
    persistDisplayScale(v === "web" && isSmallScreen ? zoom : 1)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Layout</p>
      <div className="flex gap-2">
        {(["mobile", "web"] as LayoutMode[]).map(v => (
          <button
            key={v}
            onClick={() => apply(v)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors capitalize ${
              mode === v
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
            }`}
          >
            {v === "mobile" ? "📱 Mobile" : "🖥 Web"}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {mode === "web"
          ? "Sidebar always visible. Zoomed out to fit on a phone; stays at 100% on a tablet or larger."
          : "Sidebar slides in as a drawer. Zoom at 100%."}
      </p>
    </div>
  )
}
