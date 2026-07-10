"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { persistDisplayScale } from "@/lib/display-scale"

const STEPS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2]
const DEFAULT = 1

// Find the step closest to a saved/current value so an off-grid value (e.g.
// legacy 0.5 auto-set by Web mode) doesn't disable both buttons via a -1 index.
function closestStepIndex(v: number): number {
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < STEPS.length; i++) {
    const diff = Math.abs(STEPS[i] - v)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  return best
}

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
    // Reloads — the server then renders the correct viewport <meta> from the
    // cookie it sets (see src/lib/display-scale.ts for why this must be
    // server-rendered rather than mutated client-side).
    persistDisplayScale(v)
  }

  const idx = closestStepIndex(zoom)
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
