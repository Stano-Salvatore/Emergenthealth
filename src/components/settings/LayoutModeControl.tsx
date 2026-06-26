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
    try { localStorage.setItem("layout_mode", v) } catch {}
    // Reload to re-mount DashboardShell with new mode
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
          ? "Sidebar always visible. Zoom out if content feels wide."
          : "Sidebar slides in as a drawer. Better for small screens."}
      </p>
    </div>
  )
}
