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
    // Only shrink to fit on a small screen — that trick is for squeezing a
    // desktop-style layout onto a phone. A tablet/desktop-sized screen
    // already has room to spare, so Web mode there stays at native 100% zoom
    // instead of unnecessarily zooming out (matches the auto-detected default
    // in DashboardShell for a device's first-ever visit).
    const isSmallScreen = window.innerWidth < 768
    // persistDisplayScale reloads — the server then renders the correct
    // viewport <meta> from the cookie it sets (see src/lib/display-scale.ts).
    persistDisplayScale(v === "web" && isSmallScreen ? 0.5 : 1)
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
