"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

// When a drink or meal happened. On today: now, a few quick offsets, or a
// picked time. On a past day there is no "now", so it is always a time —
// defaulting to the evening, when a forgotten drink most often belongs.
export const PAST_DAY_DEFAULT = "20:00"

const OFFSETS = [60, 180] as const

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`

export function WhenRow({ isToday, value, onChange }: {
  isToday: boolean
  /** "HH:MM" on the viewed day, or null for now (today only). */
  value: string | null
  onChange: (v: string | null) => void
}) {
  // The offsets read from when the row appeared; a minute's drift is fine.
  const [openedAt] = useState(() => Date.now())
  const chip = (active: boolean) => cn(
    "px-2 py-0.5 rounded-md text-[11px] transition-colors",
    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
  )
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-muted-foreground mr-0.5">When</span>
      {isToday && (
        <>
          <button className={chip(value === null)} onClick={() => onChange(null)}>now</button>
          {OFFSETS.map(m => {
            const t = hhmm(new Date(openedAt - m * 60_000))
            return (
              <button key={m} className={chip(value === t)} onClick={() => onChange(t)}>
                {m / 60}h ago
              </button>
            )
          })}
        </>
      )}
      <input
        type="time"
        value={value ?? ""}
        max={isToday ? hhmm(new Date(openedAt)) : undefined}
        onChange={e => onChange(e.target.value || (isToday ? null : PAST_DAY_DEFAULT))}
        aria-label="Time it happened"
        className={cn(
          "rounded-md border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary",
          value !== null && "border-primary",
        )}
      />
    </div>
  )
}
