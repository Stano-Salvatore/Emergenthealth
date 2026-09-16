// One day's events, from every place the app keeps them.
//
// There are three: Google Calendar, the phone's own calendar (synced into
// DeviceCalendarEvent) and the app's own composer (AppEvent). The calendar
// page has always read all three; the Home card and the scripted briefing
// each need the same list, and the merge was written inline once already —
// a second copy is how two screens start disagreeing about the same day.

/** The least an event needs for merging and ordering. */
export interface DayEvent {
  id: string
  title: string
  start: string | null
  isAllDay: boolean
}

/**
 * Minute granularity, title-insensitive: the same rule the Google/device merge
 * uses, so an app event mirrored into the phone's calendar counts once.
 */
function keyOf(e: DayEvent): string {
  return `${e.title.trim().toLowerCase()}|${(e.start ?? "").slice(0, 16)}`
}

/**
 * When an event happens, for sorting. An all-day entry takes the start of its
 * day so it heads the day rather than landing at whatever hour its timestamp
 * carries; anything unreadable sorts last rather than to 1970.
 */
export function eventInstant(e: DayEvent): number {
  if (!e.start) return Number.MAX_SAFE_INTEGER
  const t = Date.parse(e.isAllDay ? `${e.start.slice(0, 10)}T00:00:00Z` : e.start)
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t
}

/**
 * Calendar events first, then the app's own where they are not already there,
 * the whole list in time order. Ordering per source was the old behaviour, and
 * it let a phone event trail a later Google one — which matters wherever the
 * list is cut to the first few.
 */
export function mergeDayEvents<A extends DayEvent, B extends DayEvent>(calendar: A[], app: B[]): (A | B)[] {
  const seen = new Set(calendar.map(keyOf))
  const out: (A | B)[] = [...calendar]
  for (const e of app) {
    const k = keyOf(e)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out.sort((a, b) => eventInstant(a) - eventInstant(b))
}
