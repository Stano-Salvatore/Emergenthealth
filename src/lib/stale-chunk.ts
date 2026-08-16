// A page whose code no longer exists on the server.
//
// The Android app keeps one long-lived WebView page and the service worker
// serves the shell from cache, so a session can run a build deployed days ago.
// That works until the page reaches for a lazily-loaded chunk it never cached:
// the URL belongs to the old build, whose assets are gone, and the import
// fails. The symptom is a feature that silently isn't there.

const RELOADED_KEY = "stale_chunk_reloaded_at"

// One reload per minute. If the fresh build still can't load the chunk, a
// second reload won't fix it, and a reload loop is worse than a missing
// feature.
const COOLDOWN_MS = 60_000

export function looksLikeStaleChunk(message: string): boolean {
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(message)
}

/** Reload to pick up the current build. Returns false if it declined. */
export function reloadForFreshBuild(): boolean {
  if (typeof window === "undefined") return false
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0)
    if (Date.now() - last < COOLDOWN_MS) return false
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
  } catch {
    return false // no sessionStorage means no loop protection — don't risk it
  }
  window.location.reload()
  return true
}
