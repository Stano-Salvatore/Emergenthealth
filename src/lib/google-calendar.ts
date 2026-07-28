import { google } from "googleapis"
import { prisma } from "@/lib/prisma"

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
  source?: "google" | "device"
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
    const rows = await prisma.deviceCalendarEvent.findMany({
      where: { userId, start: { gte: from, lte: to } },
      orderBy: { start: "asc" },
    })
    return rows.map((r) => ({
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
      source: "device" as const,
    }))
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
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

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

export async function getUpcomingEvents(userId: string, daysAhead = 14): Promise<CalendarEvent[]> {
  const now = new Date()
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  let googleEvents: CalendarEvent[] = []
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

  const deviceEvents = await getDeviceEvents(userId, now, future)
  return mergeEvents(googleEvents, deviceEvents)
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
