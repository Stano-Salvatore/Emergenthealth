import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/local-date"

// The one database-backed piece of the date helpers, kept apart so that
// lib/local-date.ts stays safe for client components to import. See the note
// there.

export async function getUserTimezone(userId: string): Promise<string> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "timezone" } },
    select: { value: true },
  }).catch(() => null)
  return row?.value?.trim() || "UTC"
}

// Today, as the user's own calendar would call it.
//
// The fallback for "no date was sent" used to be the server's UTC day in a
// dozen routes. For anyone east of Greenwich that is yesterday for the first
// hours of every morning — so a habit ticked at 00:30, a mood logged on the
// way to bed, or a weight taken before dawn all landed on the wrong date, and
// the streak that depended on it broke for no reason the user could see.
export async function userToday(userId: string): Promise<string> {
  return localDateStr(await getUserTimezone(userId))
}
