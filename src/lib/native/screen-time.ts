/* eslint-disable @typescript-eslint/no-explicit-any */
// Screen-time helper — talks to the native EhUsage JS bridge that MainActivity
// exposes inside the Android app (UsageStatsManager). No-ops on the web.

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
