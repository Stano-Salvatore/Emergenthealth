"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Palette, RotateCcw } from "lucide-react"

type CalInfo = { id: string; name: string; color: string | null }

function normHex(c: string | null | undefined, fallback: string): string {
  if (!c) return fallback
  const s = c.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`
  return fallback
}

const FALLBACK = "#6366f1"

export function DeviceCalendarColors() {
  const [calendars, setCalendars] = useState<CalInfo[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch("/api/device-calendar/colors")
      .then((r) => (r.ok ? r.json() : { calendars: [], overrides: {} }))
      .then((d) => {
        setCalendars(Array.isArray(d.calendars) ? d.calendars : [])
        setOverrides(d.overrides && typeof d.overrides === "object" ? d.overrides : {})
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  function save(calendarId: string, color: string | null) {
    // Optimistic UI
    setOverrides((prev) => {
      const next = { ...prev }
      if (color) next[calendarId] = color
      else delete next[calendarId]
      return next
    })
    fetch("/api/device-calendar/colors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId, color }),
    }).catch(() => {})
  }

  // Nothing to show until a sync has recorded the phone's calendars.
  if (loaded && calendars.length === 0) return null

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Palette className="h-4 w-4 text-sky-400" />
          Calendar colours
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Pick a colour for each of your phone calendars — it overrides whatever colour the phone
          reports, so you can match your Samsung colour-coding exactly. Reload the Calendar after changing.
        </p>

        <div className="space-y-2">
          {calendars.map((c) => {
            const current = normHex(overrides[c.id] ?? c.color, FALLBACK)
            const isOverridden = !!overrides[c.id]
            return (
              <div key={c.id} className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label={`Colour for ${c.name}`}
                  value={current}
                  onChange={(e) => save(c.id, e.target.value)}
                  className="h-7 w-9 shrink-0 rounded cursor-pointer bg-transparent border border-border"
                />
                <span className="text-sm truncate flex-1">{c.name}</span>
                {isOverridden && (
                  <button
                    onClick={() => save(c.id, null)}
                    className="text-muted-foreground hover:text-foreground shrink-0 flex items-center gap-1 text-[11px]"
                    aria-label={`Reset ${c.name} to phone colour`}
                  >
                    <RotateCcw className="h-3 w-3" /> reset
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
