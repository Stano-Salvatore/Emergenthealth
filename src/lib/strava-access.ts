import { prisma } from "@/lib/prisma"
import { isOwner } from "@/lib/daily-cap"

// Whether to offer this account "Connect Strava".
//
// Strava admits one athlete to a new API app — its developer — until it
// approves a higher limit, and everyone else who connects lands on Strava's
// own "Limit of connected athletes exceeded" page. The app sent them there.
// So the offer goes only where it can work: the owner, an account connected
// now or before (disconnecting here doesn't release its place in Strava's
// limit), or everyone once the limit is raised and STRAVA_OPEN=1 is set.

export async function stravaOffered(userId: string): Promise<boolean> {
  if (process.env.STRAVA_OPEN === "1") return true
  try {
    if (await isOwner(userId)) return true
    const [rows, ever] = await Promise.all([
      prisma.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "StravaToken" WHERE "userId" = ${userId} LIMIT 1
      `,
      prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "strava_ever_connected" } }, select: { value: true } }),
    ])
    return rows.length > 0 || ever != null
  } catch {
    return false
  }
}
