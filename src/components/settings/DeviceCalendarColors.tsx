"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Palette, RotateCcw } from "lucide-react"

type CalInfo = { id: string; name: string; color: string | null }
type ColorsResp = {
  calendars?: CalInfo[]
  overrides?: Record<string, string>
  titles?: string[]
  titleOverrides?: Record<string, string>
}

function normHex(c: string | null | undefined, fallback: string): string {
  if (!c) return fallback
  const s = c.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`
  return fallback
}

// Stable, distinct default colour per name so activities start out varied.
const SWATCHES = ["#6366f1", "#8b5cf6", "#10b981", "#f97316", "#ef4444", "#06b6d4", "#ec4899", "#eab308"]
function defaultColorFor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return SWATCHES[h % SWATCHES.length]
}

export function DeviceCalendarColors() {
  const [calendars, setCalendars] = useState<CalInfo[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [titles, setTitles] = useState<string[]>([])
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch("/api/device-calendar/colors")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: ColorsResp) => {
        setCalendars(Array.isArray(d.calendars) ? d.calendars : [])
        setOverrides(d.overrides ?? {})
        setTitles(Array.isArray(d.titles) ? d.titles : [])
        setTitleOverrides(d.titleOverrides ?? {})
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  function post(payload: Record<string, unknown>) {
    fetch("/api/device-calendar/colors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }

  function saveCal(id: string, color: string | null) {
    setOverrides((p) => { const n = { ...p }; if (color) n[id] = color; else delete n[id]; return n })
    post({ calendarId: id, color })
  }
  function saveTitle(title: string, color: string | null) {
    const key = title.trim().toLowerCase().slice(0, 120)
    setTitleOverrides((p) => { const n = { ...p }; if (color) n[key] = color; else delete n[key]; return n })
    post({ title, color })
  }

  const nothing = loaded && calendars.length === 0 && titles.length === 0
  if (nothing) return null

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Palette className="h-4 w-4 text-sky-400" />
          Calendar colours
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Samsung keeps its own colours private, so pick yours here — they override what the phone
          reports. Reload the Calendar after changing.
        </p>

        {calendars.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">By calendar</p>
            {calendars.map((c) => {
              const isOn = !!overrides[c.id]
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <input type="color" aria-label={`Colour for ${c.name}`}
                    value={normHex(overrides[c.id] ?? c.color, "#6366f1")}
                    onChange={(e) => saveCal(c.id, e.target.value)}
                    className="h-7 w-9 shrink-0 rounded cursor-pointer bg-transparent border border-border" />
                  <span className="text-sm truncate flex-1">{c.name}</span>
                  {isOn && (
                    <button onClick={() => saveCal(c.id, null)}
                      className="text-muted-foreground hover:text-foreground shrink-0 flex items-center gap-1 text-[11px]">
                      <RotateCcw className="h-3 w-3" /> reset
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {titles.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              By activity (event name)
            </p>
            {titles.map((t) => {
              const key = t.trim().toLowerCase().slice(0, 120)
              const isOn = !!titleOverrides[key]
              return (
                <div key={key} className="flex items-center gap-3">
                  <input type="color" aria-label={`Colour for ${t}`}
                    value={normHex(titleOverrides[key], defaultColorFor(key))}
                    onChange={(e) => saveTitle(t, e.target.value)}
                    className="h-7 w-9 shrink-0 rounded cursor-pointer bg-transparent border border-border" />
                  <span className="text-sm truncate flex-1">{t}</span>
                  {isOn && (
                    <button onClick={() => saveTitle(t, null)}
                      className="text-muted-foreground hover:text-foreground shrink-0 flex items-center gap-1 text-[11px]">
                      <RotateCcw className="h-3 w-3" /> reset
                    </button>
                  )}
                </div>
              )
            })}
            <p className="text-[10px] text-muted-foreground/70">An activity colour wins over its calendar colour.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
