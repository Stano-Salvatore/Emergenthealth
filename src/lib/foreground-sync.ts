// A background sync that runs when the app comes to the foreground — and on
// the cold start that is the most common foreground of all.
//
// visibilitychange alone never fires for a page that is born visible, and
// Samsung kills the backgrounded app routinely: tap the icon, read, swipe it
// away, and a listener-only sync never ran.

export interface ForegroundSyncOptions {
  /** Asked once; a sync runs only after it answers true. */
  ready: () => Promise<boolean>
  sync: () => Promise<unknown>
  /** localStorage key holding the last successful sync time. */
  storageKey: string
  throttleMs: number
}

/** Starts listening, syncs once if ready, and returns the teardown. */
export function syncOnForeground({ ready, sync, storageKey, throttleMs }: ForegroundSyncOptions): () => void {
  let enabled = false
  let stopped = false
  // The throttle stamp is written only after success, so without this a
  // resume during the first (slow) sync would start a second one.
  let inFlight = false

  async function onVisible() {
    if (stopped || !enabled || inFlight) return
    if (document.visibilityState !== "visible") return

    let last: string | null = null
    try { last = localStorage.getItem(storageKey) } catch { /* no storage: sync, unthrottled */ }
    if (last && Date.now() - parseInt(last) < throttleMs) return

    inFlight = true
    try {
      await sync()
      try { localStorage.setItem(storageKey, String(Date.now())) } catch { /* next foreground retries */ }
    } catch {
      // Background sync failures are non-critical.
    } finally {
      inFlight = false
    }
  }

  ready().then(ok => {
    if (!ok || stopped) return
    enabled = true
    void onVisible()
  }).catch(() => {})

  const listener = () => { void onVisible() }
  document.addEventListener("visibilitychange", listener)
  return () => {
    stopped = true
    document.removeEventListener("visibilitychange", listener)
  }
}
