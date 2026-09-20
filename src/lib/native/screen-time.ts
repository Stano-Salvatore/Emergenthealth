/* eslint-disable @typescript-eslint/no-explicit-any */
// Screen-time helper — talks to the native EhUsage JS bridge that MainActivity
// exposes inside the Android app (UsageStatsManager). No-ops on the web.

/**
 * Whether this build can read screen time at all.
 *
 * The bridge below is complete and correct — it reads `UsageStatsManager`
 * exactly as it should. What it cannot do is ever be *allowed* to: Android
 * lists an app under Settings → Usage access only if the app's manifest
 * declares `PACKAGE_USAGE_STATS`, and this one deliberately does not.
 * `play-store/COMPLIANCE.md` is where that decision lives and why.
 *
 * So `hasPermission()` is false for the life of the build — and the two
 * screens that asked for Usage access were sending people to a list
 * Emergenthealth is not in, behind a Recheck button that could never turn
 * green. That is the "remedy that isn't rendered" failure: an instruction the
 * app cannot honour, which costs the reader more than saying nothing would.
 *
 * To switch it on, three things move together: declare the permission in
 * `.ci/customize-android.py`, flip this to true, and answer the Play Console
 * form the compliance note was written to avoid. `screen-time-declared.test.ts`
 * fails if the first two ever disagree, because a constant claiming a
 * capability the manifest does not grant is how this started.
 */
export const SCREEN_TIME_READABLE = false

export type ScreenTimeReading = {
  hasPermission: boolean
  totalMin: number
  firstUnlockMin: number | null
}

function bridge(): any | null {
  if (typeof window === "undefined") return null
  return (window as any).EhUsage ?? null
}

/** Whether the native screen-time bridge is present (i.e. running in the app). */
export function hasScreenTimeBridge(): boolean {
  return bridge() != null
}

/** True once the user has granted Usage Access in system settings. */
export function hasUsagePermission(): boolean {
  if (!SCREEN_TIME_READABLE) return false
  const b = bridge()
  try {
    return b?.hasPermission?.() === true
  } catch {
    return false
  }
}

/** Open the system "Usage access" settings screen so the user can grant it. */
export function openUsageSettings(): void {
  try {
    bridge()?.openSettings?.()
  } catch {
    /* ignore */
  }
}

/** Read today's screen time from the device. Returns null off-app or on error. */
export function readScreenTime(): ScreenTimeReading | null {
  // Not merely ungranted — ungrantable. Asking the bridge would return a
  // zero-minute day, which reads exactly like a day nobody touched their
  // phone, and that is the one answer worse than none.
  if (!SCREEN_TIME_READABLE) return null
  const b = bridge()
  if (!b) return null
  try {
    const raw = b.getToday?.()
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      hasPermission: parsed.hasPermission === true,
      totalMin: Number.isFinite(parsed.totalMin) ? parsed.totalMin : 0,
      firstUnlockMin:
        Number.isFinite(parsed.firstUnlockMin) && parsed.firstUnlockMin >= 0 ? parsed.firstUnlockMin : null,
    }
  } catch {
    return null
  }
}

/** Read today's screen time and persist it to the server. Returns the reading. */
export async function syncScreenTime(): Promise<ScreenTimeReading | null> {
  const reading = readScreenTime()
  if (!reading || !reading.hasPermission) return reading

  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-")

  try {
    await fetch("/api/screen-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, totalMin: reading.totalMin, firstUnlockMin: reading.firstUnlockMin }),
    })
  } catch {
    /* non-critical */
  }
  return reading
}
