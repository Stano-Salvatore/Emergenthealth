import { google } from "googleapis"
import { prisma } from "@/lib/prisma"
import { zonedDayRange } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"

async function buildCalendarClient(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  })
  if (!account?.access_token) throw new Error("No Google account linked")

  const oauth2Client = new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  )
  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  })

  oauth2Client.on("tokens", async (tokens) => {
    await prisma.account.update({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: account.providerAccountId,
        },
      },
      data: {
        access_token: tokens.access_token ?? account.access_token,
        ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
        ...(tokens.expiry_date && { expires_at: Math.floor(tokens.expiry_date / 1000) }),
      },
    })
  })

  return google.calendar({ version: "v3", auth: oauth2Client })
}

export interface CalendarEvent {
  id: string
  title: string
  description: string | null
  location: string | null
  start: string | null
  end: string | null
  isAllDay: boolean
  url: string | null
  color?: string | null   // hex; device events carry their phone-calendar colour
  source?: "google" | "device" | "app"
}

// ── Device calendar (native Android read: Samsung / local / any account) ──────
// Events synced from the phone's Calendar Provider are stored in the DB and
// merged into the same results Google events flow through, so they appear
// everywhere (calendar page, Today, dashboard, Dr. Sophia context).

function deviceKey(title: string, start: string | null): string {
  // Match at minute granularity so a device-side mirror of a Google event
  // dedupes against the Google copy.
  const t = title.trim().toLowerCase()
  const m = start ? start.slice(0, 16) : ""
  return `${t}|${m}`
}

async function getDeviceEvents(
  userId: string,
  from: Date,
  to: Date,
): Promise<CalendarEvent[]> {
  try {
    const [rows, overrideRow, titleRow] = await Promise.all([
      prisma.deviceCalendarEvent.findMany({
        where: { userId, start: { gte: from, lte: to } },
        orderBy: { start: "asc" },
      }),
      prisma.userPreference.findUnique({
        where: { userId_key: { userId, key: "device_calendar_overrides" } },
        select: { value: true },
      }).catch(() => null),
      prisma.userPreference.findUnique({
        where: { userId_key: { userId, key: "device_calendar_title_overrides" } },
        select: { value: true },
      }).catch(() => null),
    ])
    // Colour priority: per-activity (title) override → per-calendar override →
    // the colour read from the phone. Overrides are what the user set in Settings.
    let overrides: Record<string, string> = {}
    let titleOverrides: Record<string, string> = {}
    try { overrides = overrideRow?.value ? JSON.parse(overrideRow.value) : {} } catch { overrides = {} }
    try { titleOverrides = titleRow?.value ? JSON.parse(titleRow.value) : {} } catch { titleOverrides = {} }

    return rows.map((r) => {
      const tKey = r.title.trim().toLowerCase().slice(0, 120)
      const color =
        titleOverrides[tKey] ??
        (r.calendarId != null ? overrides[r.calendarId] : null) ??
        r.color
      return {
        id: `dev_${r.externalId}`,
        title: r.title,
        description: r.description,
        location: r.location,
        // All-day events use a date-only string (matching Google's contract) so
        // the calendar's all-day date parsing works; timed events keep full ISO.
        start: r.isAllDay ? r.start.toISOString().slice(0, 10) : r.start.toISOString(),
        end: r.end ? (r.isAllDay ? r.end.toISOString().slice(0, 10) : r.end.toISOString()) : null,
        isAllDay: r.isAllDay,
        url: null,
        color,
        source: "device" as const,
      }
    })
  } catch {
    return []
  }
}

// Merge Google + device events, dropping device events that duplicate a Google
// one (same title + start minute), and sort chronologically.
function mergeEvents(google: CalendarEvent[], device: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set(google.map((e) => deviceKey(e.title, e.start)))
  const merged = [...google]
  for (const e of device) {
    if (seen.has(deviceKey(e.title, e.start))) continue
    seen.add(deviceKey(e.title, e.start))
    merged.push(e)
  }
  return merged.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))
}

export async function getTodayEvents(userId: string): Promise<CalendarEvent[]> {
  // "Today" has to be the user's day. Deriving it from the server's clock —
  // UTC on Vercel — shifted the window by the user's offset, dropping events
  // in the early hours and pulling in the tail of the night before.
  const timezone = await getUserTimezone(userId)
  const { start: startOfDay, end: endOfDay } = zonedDayRange(timezone)

  let googleEvents: CalendarEvent[] = []
  try {
    const calendar = await buildCalendarClient(userId)
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    })

    googleEvents = (response.data.items ?? []).map((event) => ({
      id: event.id!,
      title: event.summary ?? "(No title)",
      description: event.description ?? null,
      location: event.location ?? null,
      start: event.start?.dateTime ?? event.start?.date ?? null,
      end: event.end?.dateTime ?? event.end?.date ?? null,
      isAllDay: !event.start?.dateTime,
      url: event.htmlLink ?? null,
      source: "google" as const,
    }))
  } catch {
    googleEvents = []
  }

  const deviceEvents = await getDeviceEvents(userId, startOfDay, endOfDay)
  return mergeEvents(googleEvents, deviceEvents)
}

/**
 * Whether Google Calendar took part in the answer. "unlinked" is silence by
 * design (no Google account, nothing to ask); "failed" is a linked account
 * whose request threw — a lapsed grant, a revoked scope, an outage. The two
 * used to collapse into an empty list, and the dashboard then told a user
 * whose grant had lapsed that their day was clear.
 */
export type GoogleCalendarStatus = "ok" | "unlinked" | "failed"

export async function getUpcomingEvents(userId: string, daysAhead = 14): Promise<CalendarEvent[]> {
  return (await getUpcomingEventsWithStatus(userId, daysAhead)).events
}

async function fetchGoogleUpcoming(
  userId: string,
  now: Date,
  future: Date,
): Promise<{ googleEvents: CalendarEvent[]; google: GoogleCalendarStatus }> {
  try {
    const calendar = await buildCalendarClient(userId)
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    })

    const googleEvents = (response.data.items ?? []).map((event) => ({
      id: event.id!,
      title: event.summary ?? "(No title)",
      description: event.description ?? null,
      location: event.location ?? null,
      start: event.start?.dateTime ?? event.start?.date ?? null,
      end: event.end?.dateTime ?? event.end?.date ?? null,
      isAllDay: !event.start?.dateTime,
      url: event.htmlLink ?? null,
      source: "google" as const,
    }))
    return { googleEvents, google: "ok" }
  } catch (err) {
    return {
      googleEvents: [],
      google: err instanceof Error && err.message === "No Google account linked" ? "unlinked" : "failed",
    }
  }
}

export async function getUpcomingEventsWithStatus(
  userId: string,
  daysAhead = 14,
): Promise<{ events: CalendarEvent[]; google: GoogleCalendarStatus }> {
  const now = new Date()
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)
  const { googleEvents, google } = await fetchGoogleUpcoming(userId, now, future)
  const deviceEvents = await getDeviceEvents(userId, now, future)
  return { events: mergeEvents(googleEvents, deviceEvents), google }
}

/**
 * The dashboard's calendar read. The native app is the live site in a
 * WebView, so this function's latency IS part of opening the app — and a
 * live Google round trip on every open put hundreds of milliseconds of
 * someone else's servers on the critical path. The GOOGLE half is held for
 * two minutes; a lunch moved on another device shows up a coffee-sip later,
 * which is a fair trade for the dashboard painting now.
 *
 * Only the Google half. Device and app events are one cheap DB read and
 * change from inside the app — cached, an event added a second ago would
 * vanish for two minutes. And only a fetch that SUCCEEDED is cached: a
 * lapsed grant must keep showing its banner, not a two-minute-old "ok".
 */
const GCAL_CACHE_KEY = "gcal_cache:upcoming"
const GCAL_CACHE_TTL_MS = 2 * 60_000

export async function getUpcomingEventsWithStatusCached(
  userId: string,
  daysAhead = 14,
): Promise<{ events: CalendarEvent[]; google: GoogleCalendarStatus }> {
  const now = new Date()
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: GCAL_CACHE_KEY } },
    select: { value: true },
  }).catch(() => null)
  let cached: { at: number; googleEvents: CalendarEvent[] } | null = null
  try { cached = row ? JSON.parse(row.value) : null } catch { cached = null }

  if (cached && Array.isArray(cached.googleEvents) && Date.now() - cached.at < GCAL_CACHE_TTL_MS) {
    const deviceEvents = await getDeviceEvents(userId, now, future)
    return { events: mergeEvents(cached.googleEvents, deviceEvents), google: "ok" }
  }

  const { googleEvents, google } = await fetchGoogleUpcoming(userId, now, future)
  if (google === "ok") {
    // Fire and forget — a failed cache write must not cost the dashboard.
    const value = JSON.stringify({ at: Date.now(), googleEvents })
    void prisma.userPreference.upsert({
      where: { userId_key: { userId, key: GCAL_CACHE_KEY } },
      create: { userId, key: GCAL_CACHE_KEY, value },
      update: { value },
    }).catch(() => {})
  }
  const deviceEvents = await getDeviceEvents(userId, now, future)
  return { events: mergeEvents(googleEvents, deviceEvents), google }
}

/**
 * Events across an explicit [from, to] window — past and future — merging Google
 * with synced device (Samsung/local) events. Powers the calendar page so you can
 * page back and forth across the whole year, not just the next 90 days.
 */
export async function getEventsInRange(
  userId: string,
  fromISO: string,
  toISO: string,
): Promise<CalendarEvent[]> {
  const from = new Date(fromISO)
  const to = new Date(toISO)

  let googleEvents: CalendarEvent[] = []
  try {
    const calendar = await buildCalendarClient(userId)
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
    })

    googleEvents = (response.data.items ?? []).map((event) => ({
      id: event.id!,
      title: event.summary ?? "(No title)",
      description: event.description ?? null,
      location: event.location ?? null,
      start: event.start?.dateTime ?? event.start?.date ?? null,
      end: event.end?.dateTime ?? event.end?.date ?? null,
      isAllDay: !event.start?.dateTime,
      url: event.htmlLink ?? null,
      source: "google" as const,
    }))
  } catch {
    googleEvents = []
  }

  const deviceEvents = await getDeviceEvents(userId, from, to)
  return mergeEvents(googleEvents, deviceEvents)
}
