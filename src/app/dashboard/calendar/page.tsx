"use client"

import { useEffect, useRef, useState } from "react"
import {
  addDays, addWeeks, subWeeks, startOfWeek,
  format, isSameDay, isToday, parseISO,
  differenceInMinutes,
} from "date-fns"
import { ChevronLeft, ChevronRight, RefreshCw, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"

interface CalendarEvent {
  id: string
  title: string
  description: string | null
  location: string | null
  start: string | null
  end: string | null
  isAllDay: boolean
  url: string | null
}

const HOUR_HEIGHT = 56 // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const PALETTE = [
  { bg: "bg-blue-500/20",   border: "border-l-blue-400",   text: "text-blue-200" },
  { bg: "bg-violet-500/20", border: "border-l-violet-400", text: "text-violet-200" },
  { bg: "bg-emerald-500/20",border: "border-l-emerald-400",text: "text-emerald-200" },
  { bg: "bg-amber-500/20",  border: "border-l-amber-400",  text: "text-amber-200" },
  { bg: "bg-rose-500/20",   border: "border-l-rose-400",   text: "text-rose-200" },
  { bg: "bg-cyan-500/20",   border: "border-l-cyan-400",   text: "text-cyan-200" },
]

function colorFor(idx: number) {
  return PALETTE[idx % PALETTE.length]
}

function parseEventDate(dateStr: string, isAllDay: boolean): Date {
  if (isAllDay) return new Date(dateStr + "T00:00:00")
  return parseISO(dateStr)
}

function getEventPositionStyle(start: string, end: string | null) {
  const s = parseISO(start)
  const topPx = (s.getHours() * 60 + s.getMinutes()) / 60 * HOUR_HEIGHT
  let heightPx = HOUR_HEIGHT
  if (end) {
    const e = parseISO(end)
    const durMin = differenceInMinutes(e, s)
    heightPx = Math.max(20, (durMin / 60) * HOUR_HEIGHT)
  }
  return { top: topPx, height: heightPx }
}

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Scroll to current time on mount
  useEffect(() => {
    if (gridRef.current) {
      const scrollTo = Math.max(0, now.getHours() - 2) * HOUR_HEIGHT
      gridRef.current.scrollTop = scrollTo
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/sync/calendar?days=60")
      if (!res.ok) throw new Error(await res.text())
      setEvents(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function timedEventsFor(day: Date) {
    return events.filter(e => {
      if (!e.start || e.isAllDay) return false
      return isSameDay(parseISO(e.start), day)
    })
  }

  function allDayEventsFor(day: Date) {
    return events.filter(e => {
      if (!e.start || !e.isAllDay) return false
      return isSameDay(parseEventDate(e.start, true), day)
    })
  }

  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT
  const todayInWeek = days.some(d => isToday(d))

  // Header range label
  const weekEndDay = days[6]
  const headerLabel =
    format(weekStart, "MMMM") === format(weekEndDay, "MMMM")
      ? format(weekStart, "MMMM yyyy")
      : `${format(weekStart, "MMM")} – ${format(weekEndDay, "MMM yyyy")}`

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 8rem)" }}>
      {/* ── toolbar ── */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline"
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          >
            Today
          </Button>
          <div className="flex">
            <Button size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => setWeekStart(w => subWeeks(w, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => setWeekStart(w => addWeeks(w, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-base font-semibold">{headerLabel}</span>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-400 mb-3 px-3 py-2 rounded-md bg-red-500/10">
          {error} — make sure Google Calendar is connected
        </p>
      )}

      {/* ── calendar shell ── */}
      <div className="flex-1 overflow-hidden rounded-xl border bg-card flex flex-col">

        {/* ── day-name headers ── */}
        <div className="flex flex-shrink-0 border-b">
          {/* gutter */}
          <div className="w-14 shrink-0 border-r" />
          {days.map((day, i) => {
            const today = isToday(day)
            return (
              <div key={i} className="flex-1 flex flex-col items-center py-2 border-r last:border-r-0 select-none">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {format(day, "EEE")}
                </span>
                <span className={`mt-0.5 h-7 w-7 flex items-center justify-center rounded-full text-sm font-semibold
                  ${today ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                  {format(day, "d")}
                </span>
              </div>
            )
          })}
        </div>

        {/* ── all-day row (shown only if there are all-day events) ── */}
        {days.some(d => allDayEventsFor(d).length > 0) && (
          <div className="flex flex-shrink-0 border-b min-h-[2rem]">
            <div className="w-14 shrink-0 border-r flex items-start justify-end pr-1.5 pt-1">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide">all day</span>
            </div>
            {days.map((day, i) => {
              const evts = allDayEventsFor(day)
              return (
                <div key={i} className={`flex-1 border-r last:border-r-0 px-0.5 py-0.5 space-y-0.5 ${isToday(day) ? "bg-primary/5" : ""}`}>
                  {evts.map((evt, idx) => {
                    const c = colorFor(idx)
                    return (
                      <div key={evt.id}
                        className={`text-[11px] font-medium px-1.5 py-0.5 rounded truncate border-l-2 ${c.bg} ${c.border} ${c.text}`}>
                        {evt.title}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* ── scrollable time grid ── */}
        <div ref={gridRef} className="flex-1 overflow-y-auto">
          <div className="flex relative" style={{ height: 24 * HOUR_HEIGHT }}>

            {/* time labels */}
            <div className="w-14 shrink-0 relative pointer-events-none">
              {HOURS.map(h => (
                <div
                  key={h}
                  className="absolute right-2 text-[10px] text-muted-foreground select-none"
                  style={{ top: h * HOUR_HEIGHT - 7, lineHeight: 1 }}
                >
                  {h === 0 ? "" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                </div>
              ))}
            </div>

            {/* day columns */}
            {days.map((day, dayIdx) => {
              const today = isToday(day)
              const dayEvents = timedEventsFor(day)
              return (
                <div key={dayIdx}
                  className={`flex-1 relative border-r last:border-r-0 ${today ? "bg-primary/[0.04]" : ""}`}
                >
                  {/* hour lines */}
                  {HOURS.map(h => (
                    <div key={h} className="absolute left-0 right-0 border-t border-border/20"
                      style={{ top: h * HOUR_HEIGHT }} />
                  ))}
                  {/* half-hour lines */}
                  {HOURS.map(h => (
                    <div key={`h${h}`} className="absolute left-0 right-0 border-t border-border/10"
                      style={{ top: h * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                  ))}

                  {/* current-time line */}
                  {today && todayInWeek && (
                    <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none"
                      style={{ top: nowTop }}>
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-1.5 shrink-0 shadow-sm" />
                      <div className="flex-1 h-[1.5px] bg-red-500" />
                    </div>
                  )}

                  {/* events */}
                  {dayEvents.map((evt, idx) => {
                    if (!evt.start) return null
                    const { top, height } = getEventPositionStyle(evt.start, evt.end)
                    const c = colorFor(idx)
                    const startLabel = format(parseISO(evt.start), "h:mm a")
                    const endLabel = evt.end ? format(parseISO(evt.end), "h:mm a") : null
                    return (
                      <div
                        key={evt.id}
                        className={`absolute left-[2px] right-[2px] rounded border-l-[3px] px-1.5 overflow-hidden cursor-pointer hover:brightness-110 transition-all z-10 ${c.bg} ${c.border}`}
                        style={{ top: top + 1, height: height - 2 }}
                      >
                        <p className={`text-[11px] font-semibold leading-tight truncate ${c.text}`}>
                          {evt.title}
                        </p>
                        {height > 26 && (
                          <p className={`text-[10px] leading-tight opacity-75 truncate ${c.text}`}>
                            {startLabel}{endLabel ? ` – ${endLabel}` : ""}
                          </p>
                        )}
                        {height > 48 && evt.location && (
                          <p className={`text-[10px] leading-tight opacity-60 flex items-center gap-0.5 mt-0.5 ${c.text}`}>
                            <MapPin className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{evt.location}</span>
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
