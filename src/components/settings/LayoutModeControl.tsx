"use client"

import { useState, useEffect } from "react"

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
      if (v === "web") {
        // Auto zoom-out so full sidebar + content fits on a narrow screen
        localStorage.setItem("display_zoom", "0.5")
        document.documentElement.style.zoom = "0.5"
      } else {
        // Restore default zoom when switching back to mobile
        localStorage.setItem("display_zoom", "1")
        document.documentElement.style.zoom = "1"
      }
    } catch {}
    window.location.reload()
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
          ? "Sidebar always visible, zoom set to 50% to fit everything on screen."
          : "Sidebar slides in as a drawer. Zoom at 100%."}
      </p>
    </div>
  )
}
