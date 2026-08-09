"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import {
  addDays, addWeeks, subWeeks, addMonths, subMonths,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  format, isToday, parseISO,
  differenceInMinutes, eachDayOfInterval,
} from "date-fns"
import { ChevronLeft, ChevronRight, RefreshCw, MapPin, X, Clock, Link as LinkIcon, Smartphone } from "lucide-react"
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
  color?: string | null
  source?: "google" | "device"
}

type ViewMode = "3day" | "week" | "month"

const VIEW_KEY = "calendar_view"
const DAY_COUNT: Record<string, number> = { "3day": 3, week: 7 }
const VIEW_LABEL: Record<ViewMode, string> = { "3day": "3 days", week: "Week", month: "Month" }

const HOUR_HEIGHT = 56
const HOURS = Array.from({ length: 24 }, (_, i) => i)

// Solid vivid colors — Google Calendar style
const PALETTE = [
  { solid: "bg-blue-600",    light: "bg-blue-500/15 border-l-2 border-blue-500",    dot: "bg-blue-500",    chip: "bg-blue-500/20 text-blue-300 border-l-2 border-blue-500" },
  { solid: "bg-violet-600",  light: "bg-violet-500/15 border-l-2 border-violet-500",  dot: "bg-violet-500",  chip: "bg-violet-500/20 text-violet-300 border-l-2 border-violet-500" },
  { solid: "bg-emerald-600", light: "bg-emerald-500/15 border-l-2 border-emerald-500", dot: "bg-emerald-500", chip: "bg-emerald-500/20 text-emerald-300 border-l-2 border-emerald-500" },
  { solid: "bg-orange-500",  light: "bg-orange-500/15 border-l-2 border-orange-500",  dot: "bg-orange-500",  chip: "bg-orange-500/20 text-orange-300 border-l-2 border-orange-500" },
  { solid: "bg-rose-600",    light: "bg-rose-500/15 border-l-2 border-rose-500",    dot: "bg-rose-500",    chip: "bg-rose-500/20 text-rose-300 border-l-2 border-rose-500" },
  { solid: "bg-cyan-600",    light: "bg-cyan-500/15 border-l-2 border-cyan-500",    dot: "bg-cyan-500",    chip: "bg-cyan-500/20 text-cyan-300 border-l-2 border-cyan-500" },
]

function colorFor(title: string) {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function normHex(color?: string | null): string | null {
  if (!color) return null
  const s = color.trim()
  return /^#?[0-9a-fA-F]{6}$/.test(s) ? (s.startsWith("#") ? s : `#${s}`) : null
}

// Visual for an event chip/block: the phone-calendar colour when the event
// carries one (so it matches Samsung), otherwise the hashed palette.
//  - "chip"/"block": a soft tinted fill with a coloured left bar (Samsung-style
//    pastel look) rather than a fully-saturated block.
//  - "accent": the full solid colour, for the small bar/dot in the detail panel.
function eventVisual(
  event: CalendarEvent,
  variant: "chip" | "block" | "accent",
): { className?: string; style?: CSSProperties } {
  const hex = normHex(event.color)
  if (!hex) {
    const c = colorFor(event.title)
    return { className: variant === "chip" ? c.chip : c.solid }
  }
  if (variant === "accent") return { style: { backgroundColor: hex } }
  return { style: { backgroundColor: `${hex}33`, borderLeft: `3px solid ${hex}` } }
}

// Local-midnight timestamp, for whole-day range comparisons.
function dayKey(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Whether a (possibly multi-day) event covers the given day, so multi-day
// events render across every day they span instead of only their start.
function eventCoversDay(e: CalendarEvent, day: Date): boolean {
  if (!e.start) return false
  const start = parseEventDate(e.start, e.isAllDay)
  const d = dayKey(day)
  if (!e.end) return dayKey(start) === d
  let end = parseEventDate(e.end, e.isAllDay)
  // All-day end is exclusive (midnight after the last day), so step back one.
  if (e.isAllDay) end = addDays(end, -1)
  return d >= dayKey(start) && d <= dayKey(end)
}

function parseEventDate(dateStr: string, isAllDay: boolean): Date {
  // Take only the date part so both "2026-07-25" and a full ISO string
  // ("2026-07-25T00:00:00.000Z", as device all-day events used to send) parse
  // to local midnight rather than an Invalid Date.
  if (isAllDay) return new Date(dateStr.slice(0, 10) + "T00:00:00")
  return parseISO(dateStr)
}

// Places a day's timed events so overlapping ones sit side by side. Every
// block used to be drawn the full width of its column, which meant two events
// at the same time landed exactly on top of each other and the one underneath
// was invisible.
//
// Events are grouped into clusters of mutually-overlapping blocks; within a
// cluster each event takes the first column that is free by the time it
// starts, and the cluster is divided into as many columns as it needed.
interface PositionedEvent {
  evt: CalendarEvent
  top: number
  height: number
  leftPct: number
  widthPct: number
}

const MIN_EVENT_MS = 15 * 60 * 1000

function layoutDayEvents(events: CalendarEvent[], day: Date): PositionedEvent[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000

  const spans = events
    .flatMap(e => {
      if (!e.start) return []
      const rawStart = parseISO(e.start).getTime()
      const rawEnd = e.end ? parseISO(e.end).getTime() : rawStart + 60 * 60 * 1000
      if (Number.isNaN(rawStart) || Number.isNaN(rawEnd)) return []
      // Clamp to this day so an event running past midnight shows on both days
      // rather than only the one it started on.
      const start = Math.max(rawStart, dayStart)
      const end = Math.min(Math.max(rawEnd, start + MIN_EVENT_MS), dayEnd)
      if (end <= dayStart || start >= dayEnd) return []
      return [{ evt: e, start, end }]
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const out: PositionedEvent[] = []
  let cluster: typeof spans = []
  let clusterEnd = -Infinity

  const flush = () => {
    if (!cluster.length) return
    const columnEnds: number[] = []
    const columnOf = new Map<(typeof cluster)[number], number>()
    for (const item of cluster) {
      let col = columnEnds.findIndex(end => end <= item.start)
      if (col === -1) { col = columnEnds.length; columnEnds.push(0) }
      columnEnds[col] = item.end
      columnOf.set(item, col)
    }
    const cols = columnEnds.length
    for (const item of cluster) {
      const col = columnOf.get(item) ?? 0
      out.push({
        evt: item.evt,
        top: ((item.start - dayStart) / 3600000) * HOUR_HEIGHT,
        height: Math.max(22, ((item.end - item.start) / 3600000) * HOUR_HEIGHT),
        leftPct: (col / cols) * 100,
        widthPct: 100 / cols,
      })
    }
    cluster = []
    clusterEnd = -Infinity
  }

  for (const item of spans) {
    if (cluster.length && item.start >= clusterEnd) flush()
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  flush()

  return out
}


// ── Event Detail Panel ────────────────────────────────────────────────────────

function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const v = eventVisual(event, "accent")
  const start = event.start ? (event.isAllDay ? parseEventDate(event.start, true) : parseISO(event.start)) : null
  const end = event.end ? (event.isAllDay ? parseEventDate(event.end, true) : parseISO(event.end)) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl border bg-card shadow-2xl shadow-black/40 p-5 space-y-3"
        style={{ borderTop: "3px solid" }}
        onClick={e => e.stopPropagation()}
      >
        <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl ${v.className ?? ""}`} style={v.style} />
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-sm shrink-0 ${v.className ?? ""}`} style={v.style} />
            <h3 className="font-semibold text-base leading-snug">{event.title}</h3>
          </div>
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

        {event.source === "device" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Smartphone className="h-3 w-3 shrink-0" /> From your phone calendar
          </div>
        )}
      </div>
    </div>
  )
}

// ── Month View ────────────────────────────────────────────────────────────────

function MonthView({ currentMonth, events, onEventClick }: {
  currentMonth: Date
  events: CalendarEvent[]
  onEventClick: (e: CalendarEvent) => void
}) {
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  // Exactly the weeks this month touches. It always drew six rows, so most
  // months carried a whole row of empty cells — costly on a phone.
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  function eventsOnDay(day: Date) {
    return events.filter(e => eventCoversDay(e, day))
  }

  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  return (
    <div className="flex-1 overflow-auto rounded-xl border bg-card flex flex-col">
      {/* day-of-week header */}
      <div className="grid grid-cols-7 border-b flex-shrink-0">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
          <div key={i} className={`py-2.5 text-center text-xs font-semibold uppercase tracking-wider
            ${i >= 5 ? "text-muted-foreground/50" : "text-muted-foreground/70"}`}>{d}</div>
        ))}
      </div>

      {/* grid */}
      <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((day, di) => {
              const inMonth = day.getMonth() === currentMonth.getMonth()
              const today = isToday(day)
              const isWeekend = di >= 5
              const dayEvents = eventsOnDay(day)
              return (
                <div key={di} className={`border-r last:border-r-0 p-1.5 min-h-[90px] transition-colors
                  ${today ? "bg-primary/[0.05]" : isWeekend ? "bg-secondary/20" : ""}
                  ${!inMonth ? "opacity-35" : ""}`}>
                  <div className={`w-7 h-7 flex items-center justify-center rounded-full mb-1 text-[13px] font-semibold select-none
                    ${today ? "bg-primary text-white shadow-sm shadow-primary/40" : isWeekend ? "text-muted-foreground/60" : "text-foreground/80"}`}>
                    {format(day, "d")}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map(evt => {
                      const v = eventVisual(evt, "chip")
                      return (
                        <button key={evt.id} onClick={() => onEventClick(evt)}
                          className={`w-full text-left text-[11px] font-medium px-1.5 py-[3px] rounded-[4px] truncate transition-all hover:brightness-110 ${v.className ?? "text-foreground/90"}`}
                          style={v.style}>
                          {!evt.isAllDay && evt.start && (
                            <span className="opacity-60 mr-1 font-normal">{format(parseISO(evt.start), "H:mm")}</span>
                          )}
                          {evt.title}
                        </button>
                      )
                    })}
                    {dayEvents.length > 3 && (
                      <p className="text-[10px] text-muted-foreground pl-1">+{dayEvents.length - 3} more</p>
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

function WeekView({ weekStart, dayCount, events, now, onEventClick }: {
  weekStart: Date
  dayCount: number
  events: CalendarEvent[]
  now: Date
  onEventClick: (e: CalendarEvent) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const days = Array.from({ length: dayCount }, (_, i) => addDays(weekStart, i))
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT
  const todayInWeek = days.some(d => isToday(d))

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.scrollTop = Math.max(0, now.getHours() - 2) * HOUR_HEIGHT
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function timedEventsFor(day: Date) {
    // eventCoversDay rather than a start-day match, so an event running across
    // midnight appears on both days (clamped to each by layoutDayEvents).
    return events.filter(e => !e.isAllDay && e.start && eventCoversDay(e, day))
  }
  function allDayEventsFor(day: Date) {
    return events.filter(e => e.isAllDay && eventCoversDay(e, day))
  }

  return (
    <div className="flex-1 overflow-hidden rounded-xl border bg-card flex flex-col">
      {/* day headers */}
      <div className="flex flex-shrink-0 border-b bg-card">
        <div className="w-14 shrink-0 border-r" />
        {days.map((day, i) => {
          const today = isToday(day)
          const isWeekend = dayCount === 7 && i >= 5
          return (
            <div key={i} className={`flex-1 flex flex-col items-center py-2.5 border-r last:border-r-0 select-none
              ${today ? "bg-primary/5" : ""}`}>
              <span className={`text-[10px] font-bold uppercase tracking-widest
                ${today ? "text-primary" : isWeekend ? "text-muted-foreground/50" : "text-muted-foreground/70"}`}>
                {format(day, dayCount <= 3 ? "EEEE" : "EEE")}
              </span>
              <span className={`mt-1 h-8 w-8 flex items-center justify-center rounded-full text-sm font-bold
                ${today ? "bg-primary text-white shadow-sm shadow-primary/40" : isWeekend ? "text-muted-foreground/60" : "text-foreground"}`}>
                {format(day, "d")}
              </span>
            </div>
          )
        })}
      </div>

      {/* all-day row */}
      {days.some(d => allDayEventsFor(d).length > 0) && (
        <div className="flex flex-shrink-0 border-b min-h-[2rem]">
          <div className="w-14 shrink-0 border-r flex items-start justify-end pr-2 pt-1.5">
            <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">all day</span>
          </div>
          {days.map((day, i) => {
            const evts = allDayEventsFor(day)
            return (
              <div key={i} className={`flex-1 border-r last:border-r-0 px-0.5 py-0.5 space-y-0.5 ${isToday(day) ? "bg-primary/5" : ""}`}>
                {evts.map(evt => {
                  const v = eventVisual(evt, "block")
                  return (
                    <button key={evt.id} onClick={() => onEventClick(evt)}
                      className={`w-full text-[11px] font-semibold px-1.5 py-[3px] rounded-[4px] truncate text-left text-white transition-all hover:brightness-110 ${v.className ?? ""}`}
                      style={v.style}>
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
      <div ref={gridRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="flex relative" style={{ height: 24 * HOUR_HEIGHT }}>
          {/* time labels */}
          <div className="w-14 shrink-0 relative pointer-events-none border-r border-border/30">
            {HOURS.map(h => (
              <div key={h} className="absolute right-2 text-[10px] text-muted-foreground/50 select-none tabular-nums"
                style={{ top: h * HOUR_HEIGHT - 7, lineHeight: 1 }}>
                {h === 0 ? "" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
              </div>
            ))}
          </div>

          {days.map((day, dayIdx) => {
            const today = isToday(day)
            const isWeekend = dayCount === 7 && dayIdx >= 5
            const dayEvents = timedEventsFor(day)
            return (
              <div key={dayIdx} className={`flex-1 relative border-r last:border-r-0
                ${today ? "bg-primary/[0.03]" : isWeekend ? "bg-secondary/10" : ""}`}>
                {/* hour lines */}
                {HOURS.map(h => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/20" style={{ top: h * HOUR_HEIGHT }} />
                ))}
                {/* half-hour lines */}
                {HOURS.map(h => (
                  <div key={`h${h}`} className="absolute left-0 right-0 border-t border-border/8" style={{ top: h * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                ))}

                {/* current time indicator */}
                {today && todayInWeek && (
                  <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{ top: nowTop }}>
                    <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-[5px] shrink-0 shadow shadow-red-500/50" />
                    <div className="flex-1 h-px bg-red-500 opacity-80" />
                  </div>
                )}

                {/* events — laid out so overlaps sit side by side */}
                {layoutDayEvents(dayEvents, day).map(({ evt, top, height, leftPct, widthPct }) => {
                  if (!evt.start) return null
                  const v = eventVisual(evt, "block")
                  return (
                    <button key={`${evt.id}-${day.toDateString()}`} onClick={() => onEventClick(evt)}
                      className={`absolute rounded-[5px] px-1.5 overflow-hidden
                        hover:brightness-110 active:scale-[0.98] transition-all z-10 text-left text-white ${v.className ?? ""}`}
                      style={{
                        top: top + 1,
                        height: height - 2,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        ...v.style,
                      }}>
                      <p className="text-[11px] font-semibold leading-tight truncate">{evt.title}</p>
                      {height > 28 && (
                        <p className="text-[10px] leading-tight opacity-80 truncate">
                          {format(parseISO(evt.start), "h:mm a")}{evt.end ? ` – ${format(parseISO(evt.end), "h:mm a")}` : ""}
                        </p>
                      )}
                      {height > 52 && evt.location && (
                        <p className="text-[10px] leading-tight opacity-70 flex items-center gap-0.5 mt-0.5">
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
  // Week stays the default everywhere; 3 days is an option for when seven
  // columns are too narrow to read. The choice is remembered.
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY)
      if (saved === "3day" || saved === "week" || saved === "month") setView(saved)
    } catch { /* private mode */ }
  }, [])

  function chooseView(v: ViewMode) {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
    // Moving between 3-day and week keeps you on the same day rather than
    // jumping to an unrelated week.
    if (v === "week") setWeekStart(w => startOfWeek(w, { weekStartsOn: 1 }))
  }

  // Only the visible period plus a buffer is fetched, and only re-fetched when
  // you page outside what is already loaded. Pulling ±400 days on every visit
  // meant downloading up to 2500 events before anything could render, and
  // anything past that ceiling silently never arrived at all.
  const loadedRange = useRef<{ from: number; to: number } | null>(null)
  const BUFFER_DAYS = 45

  const load = useCallback(async (centreFrom: Date, centreTo: Date, force = false) => {
    const from = addDays(centreFrom, -BUFFER_DAYS)
    const to = addDays(centreTo, BUFFER_DAYS)
    const covered =
      !force &&
      loadedRange.current !== null &&
      loadedRange.current.from <= centreFrom.getTime() &&
      loadedRange.current.to >= centreTo.getTime()
    if (covered) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/sync/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
      )
      if (!res.ok) throw new Error(String(res.status))
      setEvents(await res.json())
      loadedRange.current = { from: from.getTime(), to: to.getTime() }
    } catch {
      // The raw response body was being shown to the user — often a whole HTML
      // error page.
      setError("Couldn't load your calendar.")
    } finally {
      setLoading(false)
    }
  }, [])

  // Visible range drives what gets fetched.
  const visibleFrom = view === "month" ? startOfMonth(currentMonth) : weekStart
  const visibleTo =
    view === "month" ? endOfMonth(currentMonth) : addDays(weekStart, (DAY_COUNT[view] ?? 7) - 1)

  useEffect(() => {
    load(visibleFrom, visibleTo)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFrom.getTime(), visibleTo.getTime()])

  const dayCount = DAY_COUNT[view] ?? 7
  const weekEndDay = addDays(weekStart, dayCount - 1)
  const weekLabel =
    view === "3day"
      ? `${format(weekStart, "d MMM")} – ${format(weekEndDay, "d MMM")}`
      : format(weekStart, "MMMM") === format(weekEndDay, "MMMM")
        ? format(weekStart, "MMMM yyyy")
        : `${format(weekStart, "MMM")} – ${format(weekEndDay, "MMM yyyy")}`
  const monthLabel = format(currentMonth, "MMMM yyyy")

  function prevPeriod() {
    if (view === "month") setCurrentMonth(m => subMonths(m, 1))
    else if (view === "3day") setWeekStart(w => addDays(w, -3))
    else setWeekStart(w => subWeeks(w, 1))
  }
  function nextPeriod() {
    if (view === "month") setCurrentMonth(m => addMonths(m, 1))
    else if (view === "3day") setWeekStart(w => addDays(w, 3))
    else setWeekStart(w => addWeeks(w, 1))
  }
  function goToday() {
    setWeekStart(view === "3day" ? new Date() : startOfWeek(new Date(), { weekStartsOn: 1 }))
    setCurrentMonth(new Date())
  }

  return (
    // 100dvh follows the visible viewport on phones, and the subtraction
    // matches the padding the dashboard shell actually reserves — with 100vh
    // the bottom of the grid ended up under the tab bar.
    <div className="flex flex-col h-[calc(100dvh_-_5.75rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] lg:h-[calc(100dvh_-_3rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]">
      {/* ── toolbar ── */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={goToday}
            className="font-semibold text-xs h-8 px-3">
            Today
          </Button>
          <div className="flex rounded-lg border overflow-hidden">
            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-none border-r" onClick={prevPeriod}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-none" onClick={nextPeriod}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-lg font-bold">{view === "week" ? weekLabel : monthLabel}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* view toggle — pill style */}
          <div className="flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5">
            {(["3day", "week", "month"] as ViewMode[]).map(v => (
              <button key={v} onClick={() => chooseView(v)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap
                  ${view === v ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => load(visibleFrom, visibleTo, true)} disabled={loading} className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Sync
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          {error} Check that Google Calendar is still connected in Settings, then try Sync.
        </p>
      )}

      {view !== "month" ? (
        <WeekView weekStart={weekStart} dayCount={dayCount} events={events} now={now} onEventClick={setSelectedEvent} />
      ) : (
        <MonthView currentMonth={currentMonth} events={events} onEventClick={setSelectedEvent} />
      )}

      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  )
}
