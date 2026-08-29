"use client"

// A month of days, one mark each.
//
// The point of the whole thing is the empty ones. A dashed outline is a day
// nobody wrote anything down on, and it has to look like an absence rather
// than a bad score — otherwise a fortnight on holiday reads as a fortnight of
// misery, and the month lies about the year.

import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { STATUS_HEX, moodStatus } from "@/lib/score-color"
import { monthGrid, addMonths, type DayGlyph } from "@/lib/day-glyphs"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function monthLabel(month: string): string {
  const [y, m] = month.split("-")
  return `${MONTH_NAMES[Number(m) - 1] ?? month} ${y}`
}

function Glyph({
  day, inMonth, selected, isToday, onPick,
}: {
  day: DayGlyph | null
  inMonth: boolean
  selected: boolean
  isToday: boolean
  onPick: () => void
}) {
  const num = day ? Number(day.date.slice(8)) : null
  const mood = day?.mood ?? null
  const recorded = day?.recorded ?? false

  // Filled only when the day actually happened. Mood colours it when there is
  // one; otherwise a neutral disc says "something was recorded here" without
  // implying it went well or badly.
  const background = !recorded ? "transparent"
    : mood != null ? STATUS_HEX[moodStatus(mood)]
    : "rgba(255,255,255,0.14)"

  return (
    <button
      type="button"
      onClick={onPick}
      title={day?.summary ?? undefined}
      className={cn(
        "relative aspect-square w-full max-w-[38px] mx-auto rounded-full flex items-center justify-center",
        "text-[11px] transition-all",
        recorded ? "font-semibold" : "border border-dashed border-border/70",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isToday && !selected && "ring-1 ring-primary/50",
        inMonth ? "opacity-100" : "opacity-25",
        "hover:brightness-110 active:scale-95",
      )}
      style={{
        background,
        // Dark text on the light status discs, muted on the empty ones.
        color: recorded && mood != null ? "#0b1220" : undefined,
      }}
    >
      <span className={cn(!recorded && "text-muted-foreground/70")}>{num}</span>
      {(day?.symptoms ?? 0) > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full"
          style={{ background: "#fbbf24" }}
        />
      )}
    </button>
  )
}

export default function MonthGlyphs({
  selectedDate, today, onPick,
}: {
  selectedDate: string
  today: string
  onPick: (date: string) => void
}) {
  const [month, setMonth] = useState(selectedDate.slice(0, 7))
  const [days, setDays] = useState<Record<string, DayGlyph>>({})
  const [loading, setLoading] = useState(true)

  // Follow the day picker: choosing a date outside the month on screen moves
  // the month to it, rather than leaving the grid arguing with the page.
  useEffect(() => { setMonth(selectedDate.slice(0, 7)) }, [selectedDate])

  const load = useCallback(async (m: string) => {
    try {
      const res = await fetch(`/api/timeline/month?month=${m}`)
      if (!res.ok) return
      const json = await res.json() as { month: string; days: DayGlyph[] }
      if (json.month !== m) return
      setDays(Object.fromEntries(json.days.map(d => [d.date, d])))
    } catch {
      // A month that will not load leaves the grid empty, which is honest:
      // every day reads as unknown, because to this screen it is.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(month) }, [month, load])

  const cells = monthGrid(month)
  const recordedCount = cells.filter(c => c.inMonth && days[c.date]?.recorded).length
  // Days that have not happened are not days you missed, so they are not in
  // the denominator either. In the current month that is the difference
  // between "28 of 29" and "28 of 31".
  const soFar = cells.filter(c => c.inMonth && !days[c.date]?.future).length

  return (
    <div className="rounded-2xl border border-border/60 bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <button
          type="button"
          onClick={() => setMonth(m => addMonths(m, -1))}
          aria-label="Previous month"
          className="h-7 w-7 flex items-center justify-center rounded-lg border border-border bg-secondary/50 hover:bg-accent transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-sm font-semibold">{monthLabel(month)}</span>
        <button
          type="button"
          onClick={() => setMonth(m => addMonths(m, 1))}
          disabled={month >= today.slice(0, 7)}
          aria-label="Next month"
          className="h-7 w-7 flex items-center justify-center rounded-lg border border-border bg-secondary/50 hover:bg-accent transition-colors disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[9px] uppercase tracking-wide text-muted-foreground/60">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(c => (
          <Glyph
            key={c.date}
            day={days[c.date] ?? null}
            inMonth={c.inMonth}
            selected={c.date === selectedDate}
            isToday={c.date === today}
            onPick={() => onPick(c.date)}
          />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground mt-2.5">
        {loading
          ? "Reading the month…"
          : <>
              {`${recordedCount} of ${soFar} days so far have something recorded. `}
              Colour is that day&apos;s mood; a plain disc is a day logged without one;
              a dashed outline is a day nothing was written down on — not a bad day.
              {" "}<span style={{ color: "#fbbf24" }}>•</span> marks a symptom.
            </>}
      </p>
    </div>
  )
}
