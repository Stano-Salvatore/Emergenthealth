// Several dashboard widgets independently request the same URL on the same
// page load (e.g. every insight card asks for location correlations). This
// collapses identical GETs into one request: concurrent callers share the
// in-flight promise, and a short TTL covers widgets that mount slightly apart.

const TTL_MS = 30_000

type Entry = { at: number; promise: Promise<unknown> }
const cache = new Map<string, Entry>()

export function sharedFetchJson<T = unknown>(url: string, ttlMs = TTL_MS): Promise<T> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise as Promise<T>

  const promise = fetch(url)
    .then(r => r.json())
    .catch(err => {
      // Never cache a failure — the next widget (or retry) should try again
      cache.delete(url)
      throw err
    })

  cache.set(url, { at: Date.now(), promise })
  return promise as Promise<T>
}

/** Drop cached entries so the next call refetches (used after a regenerate). */
export function invalidateSharedFetch(urlPrefix?: string): void {
  if (!urlPrefix) { cache.clear(); return }
  for (const key of cache.keys()) {
    if (key.startsWith(urlPrefix)) cache.delete(key)
  }
}
