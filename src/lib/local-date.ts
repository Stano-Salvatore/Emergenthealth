// Server-side "what day is it for this user?" helpers.
//
// The server runs in UTC, so `new Date()` there is not the user's day. For a
// user in UTC+2 the two disagree between 00:00 and 02:00 local — long enough
// that a habit ticked just after midnight was being filed under yesterday.
// Everything here works in plain YYYY-MM-DD strings, which compare and sort
// correctly without any further timezone juggling.

import { prisma } from "@/lib/prisma"

export async function getUserTimezone(userId: string): Promise<string> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "timezone" } },
    select: { value: true },
  }).catch(() => null)
  return row?.value?.trim() || "UTC"
}

// Today's date in the user's timezone. en-CA formats as YYYY-MM-DD.
export function localDateStr(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

// Current wall-clock time in the user's timezone, as "HH:MM" (24h).
export function localTimeStr(timezone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at)
    const h = parts.find(p => p.type === "hour")?.value ?? "00"
    const m = parts.find(p => p.type === "minute")?.value ?? "00"
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`
  } catch {
    return at.toISOString().slice(11, 16)
  }
}

// Shift a YYYY-MM-DD string by n days, staying in date-string space.
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
