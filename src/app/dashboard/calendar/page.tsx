"use client"

import { useEffect, useRef, useState } from "react"
import {
  addDays, addWeeks, subWeeks, addMonths, subMonths,
  startOfWeek, startOfMonth, endOfMonth,
  format, isSameDay, isToday, parseISO,
  differenceInMinutes, eachDayOfInterval,
} from "date-fns"
import { ChevronLeft, ChevronRight, RefreshCw, MapPin, X, Clock, Link as LinkIcon } from "lucide-react"
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

type ViewMode = "week" | "month"

const HOUR_HEIGHT = 56
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const PALETTE = [
  { bg: "bg-blue-500/20",    border: "border-l-blue-400",    text: "text-blue-200",    dot: "bg-blue-400" },
  { bg: "bg-violet-500/20",  border: "border-l-violet-400",  text: "text-violet-200",  dot: "bg-violet-400" },
  { bg: "bg-emerald-500/20", border: "border-l-emerald-400", text: "text-emerald-200", dot: "bg-emerald-400" },
  { bg: "bg-amber-500/20",   border: "border-l-amber-400",   text: "text-amber-200",   dot: "bg-amber-400" },
  { bg: "bg-rose-500/20",    border: "border-l-rose-400",    text: "text-rose-200",    dot: "bg-rose-400" },
  { bg: "bg-cyan-500/20",    border: "border-l-cyan-400",    text: "text-cyan-200",    dot: "bg-cyan-400" },
]

function colorFor(title: string) {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
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

// ── Event Detail Panel ────────────────────────────────────────────────────────

function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const c = colorFor(event.title)
  const start = event.start ? (event.isAllDay ? parseEventDate(event.start, true) : parseISO(event.start)) : null
  const end = event.end ? (event.isAllDay ? parseEventDate(event.end, true) : parseISO(event.end)) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className={`relative w-full max-w-sm rounded-2xl border bg-card shadow-2xl p-5 space-y-3 border-l-4 ${c.border}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-base leading-snug">{event.title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {start && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {event.isAllDay
              ? format(start, "EEEE, MMMM d")
              : `${format(start, "EEE, MMM d · h:mm a")}${end ? ` – ${format(end, "h:mm a")}` : ""}`}
          </div>
        )}

        {event.location && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{event.location}</span>
          </div>
        )}

        {event.description && (
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
            {event.description.replace(/<[^>]+>/g, "")}
          </p>
        )}

        {event.url && (
          <a href={event.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline">
            <LinkIcon className="h-3 w-3" /> Open in Google Calendar
          </a>
        )}
      </div>
    </div>
  )
}

// ── Month View ────────────────────────────────────────────────────────────────

function MonthView({
  currentMonth, events, onEventClick,
}: {
  currentMonth: Date
  events: CalendarEvent[]
  onEventClick: (e: CalendarEvent) => void
}) {
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)

  // Build calendar grid: start on Monday
  let gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  // Ensure we show at least 6 weeks for a consistent height
  const days = eachDayOfInterval({ start: gridStart, end: addDays(monthEnd, 6 * 7) }).slice(0, 42)

  function eventsOnDay(day: Date) {
    return events.filter(e => {
      if (!e.start) return false
      const d = parseEventDate(e.start, e.isAllDay)
      return isSameDay(d, day)
    })
  }

  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  return (
    <div className="flex-1 overflow-auto rounded-xl border bg-card flex flex-col">
      {/* header */}
      <div className="grid grid-cols-7 border-b flex-shrink-0">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d,i) => (
          <div key={i} className={`py-2 text-center text-xs font-semibold uppercase tracking-wide
            ${i>=5 ? "text-red-400/70" : "text-muted-foreground"}`}>{d}</div>
        ))}
      </div>

      {/* grid */}
      <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((day, di) => {
              const inMonth = day.getMonth() === currentMonth.getMonth()
              const today = isToday(day)
              const dayEvents = eventsOnDay(day)
              return (
                <div key={di} className={`border-r last:border-r-0 p-1 min-h-[80px]
                  ${today ? "bg-primary/[0.04]" : ""}
                  ${!inMonth ? "opacity-40" : ""}`}>
                  <div className={`w-6 h-6 flex items-center justify-center rounded-full mb-1 text-xs font-semibold
                    ${today ? "bg-primary text-primary-foreground" : di>=5 ? "text-red-400" : ""}`}>
                    {format(day, "d")}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map(evt => {
                      const c = colorFor(evt.title)
                      return (
                        <button key={evt.id} onClick={() => onEventClick(evt)}
                          className={`w-full text-left text-[10px] font-medium px-1.5 py-0.5 rounded truncate
                            border-l-2 ${c.bg} ${c.border} ${c.text} hover:brightness-110 transition-all`}>
                          {!evt.isAllDay && evt.start && (
                            <span className="opacity-70 mr-0.5">{format(parseISO(evt.start),"HH:mm")}</span>
                          )}
                          {evt.title}
                        </button>
                      )
                    })}
                    {dayEvents.length > 3 && (
                      <p className="text-[10px] text-muted-foreground pl-1">+{dayEvents.length-3} more</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Week View ─────────────────────────────────────────────────────────────────

function WeekView({
  weekStart, events, now, onEventClick,
}: {
  weekStart: Date
  events: CalendarEvent[]
  now: Date
  onEventClick: (e: CalendarEvent) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT
  const todayInWeek = days.some(d => isToday(d))

  useEffect(() => {
    if (gridRef.current) {
      const scrollTo = Math.max(0, now.getHours() - 2) * HOUR_HEIGHT
      gridRef.current.scrollTop = scrollTo
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function timedEventsFor(day: Date) {
    return events.filter(e => !e.isAllDay && e.start && isSameDay(parseISO(e.start), day))
  }
  function allDayEventsFor(day: Date) {
    return events.filter(e => e.isAllDay && e.start && isSameDay(parseEventDate(e.start, true), day))
  }

  return (
    <div className="flex-1 overflow-hidden rounded-xl border bg-card flex flex-col">
      {/* day headers */}
      <div className="flex flex-shrink-0 border-b">
        <div className="w-14 shrink-0 border-r" />
        {days.map((day, i) => {
          const today = isToday(day)
          return (
            <div key={i} className="flex-1 flex flex-col items-center py-2 border-r last:border-r-0 select-none">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {format(day,"EEE")}
              </span>
              <span className={`mt-0.5 h-7 w-7 flex items-center justify-center rounded-full text-sm font-semibold
                ${today ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                {format(day,"d")}
              </span>
            </div>
          )
        })}
      </div>

      {/* all-day row */}
      {days.some(d => allDayEventsFor(d).length > 0) && (
        <div className="flex flex-shrink-0 border-b min-h-[2rem]">
          <div className="w-14 shrink-0 border-r flex items-start justify-end pr-1.5 pt-1">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide">all day</span>
          </div>
          {days.map((day, i) => {
            const evts = allDayEventsFor(day)
            return (
              <div key={i} className={`flex-1 border-r last:border-r-0 px-0.5 py-0.5 space-y-0.5 ${isToday(day)?"bg-primary/5":""}`}>
                {evts.map((evt, idx) => {
                  const c = colorFor(evt.title)
                  return (
                    <button key={evt.id} onClick={() => onEventClick(evt)}
                      className={`w-full text-[11px] font-medium px-1.5 py-0.5 rounded truncate border-l-2 text-left
                        ${c.bg} ${c.border} ${c.text} hover:brightness-110 transition-all`}>
                      {evt.title}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* scrollable time grid */}
      <div ref={gridRef} className="flex-1 overflow-y-auto">
        <div className="flex relative" style={{ height: 24 * HOUR_HEIGHT }}>
          <div className="w-14 shrink-0 relative pointer-events-none">
            {HOURS.map(h => (
              <div key={h} className="absolute right-2 text-[10px] text-muted-foreground select-none"
                style={{ top: h * HOUR_HEIGHT - 7, lineHeight: 1 }}>
                {h===0 ? "" : h<12 ? `${h} AM` : h===12 ? "12 PM" : `${h-12} PM`}
              </div>
            ))}
          </div>

          {days.map((day, dayIdx) => {
            const today = isToday(day)
            const dayEvents = timedEventsFor(day)
            return (
              <div key={dayIdx} className={`flex-1 relative border-r last:border-r-0 ${today?"bg-primary/[0.04]":""}`}>
                {HOURS.map(h => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/20" style={{ top: h*HOUR_HEIGHT }} />
                ))}
                {HOURS.map(h => (
                  <div key={`h${h}`} className="absolute left-0 right-0 border-t border-border/10" style={{ top: h*HOUR_HEIGHT+HOUR_HEIGHT/2 }} />
                ))}

                {today && todayInWeek && (
                  <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{ top: nowTop }}>
                    <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-1.5 shrink-0 shadow-sm" />
                    <div className="flex-1 h-[1.5px] bg-red-500" />
                  </div>
                )}

                {dayEvents.map((evt) => {
                  if (!evt.start) return null
                  const { top, height } = getEventPositionStyle(evt.start, evt.end)
                  const c = colorFor(evt.title)
                  return (
                    <button key={evt.id} onClick={() => onEventClick(evt)}
                      className={`absolute left-[2px] right-[2px] rounded border-l-[3px] px-1.5 overflow-hidden
                        hover:brightness-110 transition-all z-10 text-left ${c.bg} ${c.border}`}
                      style={{ top: top+1, height: height-2 }}>
                      <p className={`text-[11px] font-semibold leading-tight truncate ${c.text}`}>{evt.title}</p>
                      {height>26 && (
                        <p className={`text-[10px] leading-tight opacity-75 truncate ${c.text}`}>
                          {format(parseISO(evt.start),"h:mm a")}{evt.end ? ` – ${format(parseISO(evt.end),"h:mm a")}` : ""}
                        </p>
                      )}
                      {height>48 && evt.location && (
                        <p className={`text-[10px] leading-tight opacity-60 flex items-center gap-0.5 mt-0.5 ${c.text}`}>
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{evt.location}</span>
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [view, setView] = useState<ViewMode>("week")
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/sync/calendar?days=90")
      if (!res.ok) throw new Error(await res.text())
      setEvents(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ── Header label
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEndDay = days[6]
  const weekLabel =
    format(weekStart,"MMMM") === format(weekEndDay,"MMMM")
      ? format(weekStart,"MMMM yyyy")
      : `${format(weekStart,"MMM")} – ${format(weekEndDay,"MMM yyyy")}`
  const monthLabel = format(currentMonth,"MMMM yyyy")

  function prevPeriod() {
    if (view==="week") setWeekStart(w => subWeeks(w,1))
    else setCurrentMonth(m => subMonths(m,1))
  }
  function nextPeriod() {
    if (view==="week") setWeekStart(w => addWeeks(w,1))
    else setCurrentMonth(m => addMonths(m,1))
  }
  function goToday() {
    setWeekStart(startOfWeek(new Date(),{weekStartsOn:1}))
    setCurrentMonth(new Date())
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 8rem)" }}>
      {/* toolbar */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={goToday}>Today</Button>
          <div className="flex">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={prevPeriod}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={nextPeriod}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-base font-semibold">{view==="week" ? weekLabel : monthLabel}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* view toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            {(["week","month"] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize
                  ${view===v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                {v}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading?"animate-spin":""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 mb-3 px-3 py-2 rounded-md bg-red-500/10">
          {error} — make sure Google Calendar is connected
        </p>
      )}

      {view === "week" ? (
        <WeekView weekStart={weekStart} events={events} now={now} onEventClick={setSelectedEvent} />
      ) : (
        <MonthView currentMonth={currentMonth} events={events} onEventClick={setSelectedEvent} />
      )}

      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  )
}
