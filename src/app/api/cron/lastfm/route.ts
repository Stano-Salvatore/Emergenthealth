import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { syncLastfm, syncArtistGenres } from "@/lib/lastfm"
import { recordSync } from "@/lib/sync-status-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// Server-side Last.fm sync for every connected user.
//
// Until this cron existed, scrobbles arrived only when the app was opened, and
// the call sat inside a Promise.allSettled that discarded the rejection — so a
// revoked API key or a Last.fm outage looked exactly like a quiet week. The
// music correlations ran on whatever the last successful app-open had fetched,
// and nothing on any screen said the source had stopped.
//
// Genre tagging rides along: the correlation engine reads a day's genre from
// its top artist, so artists that arrive here and are never tagged simply drop
// out of the genre families instead of failing loudly.
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const keys = await prisma.$queryRaw<{ userId: string; apiKey: string; username: string }[]>`
    SELECT "userId", "apiKey", "username" FROM "LastfmKey"
  `.catch(() => [] as { userId: string; apiKey: string; username: string }[])

  let totalSynced = 0
  const errors: string[] = []

  for (const { userId, apiKey, username } of keys) {
    // syncLastfm throws on an API error rather than returning a result, so one
    // user's revoked key must not end the run for everyone after them.
    try {
      const { synced } = await syncLastfm(userId, apiKey, username)
      await recordSync(userId, "lastfm", { ok: true, items: synced })
      totalSynced += synced
      // Best-effort: a genre pass that fails leaves the day rows correct and
      // only costs the genre families, so it must not fail the sync itself.
      await syncArtistGenres(userId, apiKey).catch(() => null)
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : "sync failed"
      await recordSync(userId, "lastfm", { ok: false, error })
      console.error("[cron/lastfm] failed for", userId, error)
      errors.push(`${userId}: ${error}`)
    }
  }

  return NextResponse.json({
    ok: true,
    users: keys.length,
    synced: totalSynced,
    ...(errors.length ? { errors } : {}),
  })
}
