import { prisma } from "@/lib/prisma"

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
