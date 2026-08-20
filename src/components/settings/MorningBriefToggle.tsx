"use client"

import { Card, CardContent } from "@/components/ui/card"
import { readLocalString, useLocalSetting } from "@/lib/use-client-value"

const DISABLED_KEY = "morning_brief_off"
const LAST_SHOWN_KEY = "morning_brief_last"

// Counterpart to the "Don't show automatically" link inside the popup, so
// turning it off isn't a one-way door.
export function MorningBriefToggle() {
  const [enabled, setEnabled] = useLocalSetting(
    () => readLocalString(DISABLED_KEY, "") !== "1",
    true,
  )

  function toggle() {
    const next = !enabled
    setEnabled(next)
    try {
      if (next) {
        localStorage.removeItem(DISABLED_KEY)
        // Clear today's stamp so it can appear again this morning
        localStorage.removeItem(LAST_SHOWN_KEY)
      } else {
        localStorage.setItem(DISABLED_KEY, "1")
      }
    } catch {}
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">🌅 Morning brief popup</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Shows your day&apos;s brief automatically the first time you open the app before noon.
          </p>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={enabled}
          aria-label="Morning brief popup"
          className={`shrink-0 relative h-6 w-11 rounded-full transition-colors ${enabled ? "bg-primary" : "bg-secondary border border-border"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
          />
        </button>
      </CardContent>
    </Card>
  )
}
