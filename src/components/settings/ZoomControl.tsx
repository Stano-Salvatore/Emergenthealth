"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"

const STEPS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2]
const DEFAULT = 1

export function ZoomControl() {
  const [zoom, setZoom] = useState(DEFAULT)

  useEffect(() => {
    try {
      const saved = localStorage.getItem("display_zoom")
      if (saved) {
        const v = parseFloat(saved)
        if (!isNaN(v)) setZoom(v)
      }
    } catch {}
  }, [])

  function apply(v: number) {
    setZoom(v)
    document.documentElement.style.zoom = String(v)
    try { localStorage.setItem("display_zoom", String(v)) } catch {}
  }

  const idx = STEPS.indexOf(zoom)
  const canDecrease = idx > 0
  const canIncrease = idx < STEPS.length - 1

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Display Zoom</p>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0 text-lg"
          disabled={!canDecrease}
          onClick={() => apply(STEPS[Math.max(0, idx - 1)])}
        >
          −
        </Button>
        <span className="flex-1 text-center text-sm font-medium tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0 text-lg"
          disabled={!canIncrease}
          onClick={() => apply(STEPS[Math.min(STEPS.length - 1, idx + 1)])}
        >
          +
        </Button>
      </div>
      {zoom !== DEFAULT && (
        <button
          onClick={() => apply(DEFAULT)}
          className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          Reset to 100%
        </button>
      )}
    </div>
  )
}
