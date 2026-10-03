import { prisma } from "@/lib/prisma"

/**
 * The ids in `ids` that are habits of this user, in the order given.
 *
 * A routine stores habit ids from the request body, and completing it writes
 * a completion for each. An id from another account must never get that far:
 * readers join completions through the habit, so it would tick that habit
 * done for its owner. Anything not a string, or not this user's, is dropped.
 */
export async function ownHabitIds(userId: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) return []
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === "string"))].slice(0, 200)
  if (wanted.length === 0) return []
  const owned = await prisma.habit.findMany({ where: { id: { in: wanted }, userId }, select: { id: true } })
  const mine = new Set(owned.map(h => h.id))
  return wanted.filter(id => mine.has(id))
}
