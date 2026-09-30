"use client"

import { cn } from "@/lib/utils"
import type { WhenChoice } from "@/lib/backfill-time"

// When a drink or meal happened. On today: now, a few quick offsets, or a
// picked time. On a past day there is no "now", so it is always a time —
// defaulting to the evening, when a forgotten drink most often belongs.
export const PAST_DAY_DEFAULT: WhenChoice = { at: "20:00" }

const OFFSETS = [60, 180] as const

export function WhenRow({ isToday, value, onChange }: {
  isToday: boolean
  value: WhenChoice
  onChange: (v: WhenChoice) => void
}) {
  const chip = (active: boolean) => cn(
    "px-2 py-0.5 rounded-md text-[11px] transition-colors",
    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
  )
  const picked = value && "at" in value ? value.at : ""
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-muted-foreground mr-0.5">When</span>
      {isToday && (
        <>
          <button className={chip(value === null)} onClick={() => onChange(null)}>now</button>
          {OFFSETS.map(m => (
            <button key={m} className={chip(!!value && "ago" in value && value.ago === m)} onClick={() => onChange({ ago: m })}>
              {m / 60}h ago
            </button>
          ))}
        </>
      )}
      <input
        type="time"
        value={picked}
        onChange={e => onChange(e.target.value ? { at: e.target.value } : (isToday ? null : PAST_DAY_DEFAULT))}
        aria-label="Time it happened"
        className={cn(
          "rounded-md border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary",
          picked && "border-primary",
        )}
      />
    </div>
  )
}
