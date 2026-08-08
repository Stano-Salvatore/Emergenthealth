// V3 Play Store release: everything in this file already works — held-back
// features are hidden from navigation and their routes redirect to /dashboard
// so they can be launched one at a time in later releases (v3.1, v3.2, …).
//
// To launch a feature: remove its key from HELD_BACK below, or set
// NEXT_PUBLIC_ENABLED_FEATURES="finances,gmail" in the environment to enable
// without a code change. Works in server components, proxy, and client code.

export type FeatureKey =
  | "finances"
  | "smarthome"
  | "gmail"
  | "strava"
  | "lastfm"
  | "rescuetime"
  | "labs"
  | "screentime"
  | "fasting"

export const FEATURE_ROUTES: Record<FeatureKey, string[]> = {
  finances:   ["/dashboard/finances", "/dashboard/bills", "/dashboard/subscriptions"],
  smarthome:  ["/dashboard/home"],
  gmail:      ["/dashboard/gmail"],
  strava:     ["/dashboard/strava"],
  lastfm:     ["/dashboard/lastfm"],
  rescuetime: ["/dashboard/rescuetime"],
  labs:       ["/dashboard/labs"],
  screentime: [],
  fasting:    ["/dashboard/fasting"],
}

const HELD_BACK: FeatureKey[] = [
  "finances",
  "smarthome",
  "gmail",
  "strava",
  "lastfm",
  "rescuetime",
  "labs",
  "screentime",
  // Built and working, but never linked from anywhere — holding it as a
  // proper future release instead of leaving it an accidental orphan.
  "fasting",
]

function envOverrides(): Set<string> {
  return new Set(
    (process.env.NEXT_PUBLIC_ENABLED_FEATURES ?? "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  )
}

export function isFeatureEnabled(key: FeatureKey): boolean {
  if (!HELD_BACK.includes(key)) return true
  return envOverrides().has(key)
}

const DISABLED_ROUTES: Map<string, FeatureKey> = new Map(
  (Object.entries(FEATURE_ROUTES) as [FeatureKey, string[]][])
    .flatMap(([key, routes]) => routes.map(r => [r, key] as [string, FeatureKey]))
)

// A route is enabled unless it belongs to a feature that is still held back.
export function isRouteEnabled(pathname: string): boolean {
  for (const [route, key] of DISABLED_ROUTES) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      return isFeatureEnabled(key)
    }
  }
  return true
}
