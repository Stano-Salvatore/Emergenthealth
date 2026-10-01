"use client"

// A month of the cycle: logged days as they were logged, predictions drawn
// only forward from today. Tapping a day opens it in the logger.

import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { addDaysISO } from "@/lib/local-date"
import type { CycleDayLog, DayMark } from "@/lib/cycle"

interface Props {
  month: string // YYYY-MM
  marks: Record<string, DayMark>
  logs: Map<string, CycleDayLog>
  today: string
  selected: string
  onSelect: (day: string) => void
  onMonth: (month: string) => void
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"]
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number)
  const first = `${month}-01`
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => addDaysISO(first, i))
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

const MARK_CLASS: Record<DayMark, string> = {
  period: "bg-rose-500 text-white font-semibold",
  between: "bg-rose-400/60 text-white",
  spotting: "",
  predicted: "border-2 border-dashed border-rose-400/70 text-rose-300",
  fertile: "bg-emerald-500/15 text-emerald-300",
  ovulation: "border-2 border-amber-400 bg-amber-400/15 text-amber-300 font-semibold",
  break: "bg-muted/60 text-muted-foreground",
}

export function CycleCalendar({ month, marks, logs, today, selected, onSelect, onMonth }: Props) {
  const days = monthDays(month)
  const [y, m] = month.split("-").map(Number)
  // Monday-first: how many blanks before the 1st.
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => onMonth(shiftMonth(month, -1))} className="p-1.5 rounded-md hover:bg-muted" aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold">{MONTH_NAMES[m - 1]} {y}</p>
        <button onClick={() => onMonth(shiftMonth(month, 1))} className="p-1.5 rounded-md hover:bg-muted" aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => <p key={i} className="text-[10px] text-muted-foreground py-1">{w}</p>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {days.map(d => {
          const mark = marks[d]
          const log = logs.get(d)
          const extra = log && !mark && ((log.symptoms?.length ?? 0) > 0 || (log.moods?.length ?? 0) > 0 || log.pain || log.note || log.lhTest || log.discharge)
          const future = d > today
          return (
            <button
              key={d}
              onClick={() => !future && onSelect(d)}
              disabled={future}
              className={cn(
                "relative aspect-square rounded-full text-xs flex items-center justify-center tabular-nums transition-colors",
                mark ? MARK_CLASS[mark] : future ? "text-muted-foreground/60" : "hover:bg-muted",
                d === today && "ring-1 ring-primary",
                d === selected && "ring-2 ring-primary",
              )}
              aria-label={`${d}${mark ? `, ${mark}` : ""}`}
            >
              {Number(d.slice(8))}
              {(mark === "spotting" || extra) && (
                <span className={cn("absolute bottom-1 h-1 w-1 rounded-full", mark === "spotting" ? "bg-rose-400" : "bg-muted-foreground/70")} />
              )}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Period</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-rose-400" /> Predicted</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500/40" /> Fertile (estimate)</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-amber-400" /> Ovulation</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> Spotting</span>
      </div>
    </div>
  )
}
