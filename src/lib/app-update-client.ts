// The client half of the update check: ask /api/version at most every few
// hours, remember the answer, and hand back a verdict. Shared by the Settings
// card and the banner so they can never disagree about which build is new.

import { installedBuild } from "@/lib/native/build"
import { isNativeShell } from "@/lib/native/shell"
import { judgeUpdate, type UpdateVerdict } from "@/lib/app-update"

export interface UpdateCheck {
  verdict: UpdateVerdict
  apkUrl: string | null
  releaseUrl: string | null
  publishedAt: string | null
  checkedAt: string
}

const CACHE_KEY = "app_update_check"
const CACHE_MS = 6 * 60 * 60 * 1000

interface Cached { latestBuild: number | null; apkUrl: string | null; releaseUrl: string | null; publishedAt: string | null; checkedAt: string }

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Cached
    if (Date.now() - Date.parse(c.checkedAt) > CACHE_MS) return null
    return c
  } catch {
    return null
  }
}

/**
 * Only ever meaningful in the shell — a browser tab has no APK to be behind.
 * `force` skips the cache for the Settings card's "Check now".
 */
export async function checkForUpdate(force = false): Promise<UpdateCheck | null> {
  if (!isNativeShell()) return null
  let cached = force ? null : readCache()
  if (!cached) {
    const res = await fetch("/api/version", { cache: "no-store" }).catch(() => null)
    const data = res?.ok
      ? await res.json().catch(() => null) as { android?: { latestBuild: number; apkUrl: string | null; releaseUrl: string; publishedAt: string | null } | null } | null
      : null
    cached = {
      latestBuild: data?.android?.latestBuild ?? null,
      apkUrl: data?.android?.apkUrl ?? null,
      releaseUrl: data?.android?.releaseUrl ?? null,
      publishedAt: data?.android?.publishedAt ?? null,
      checkedAt: new Date().toISOString(),
    }
    // A failed check is not cached: the next app open gets to try again.
    if (cached.latestBuild != null) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cached)) } catch { /* private mode */ }
    }
  }
  return {
    verdict: judgeUpdate(installedBuild(), cached.latestBuild),
    apkUrl: cached.apkUrl,
    releaseUrl: cached.releaseUrl,
    publishedAt: cached.publishedAt,
    checkedAt: cached.checkedAt,
  }
}
