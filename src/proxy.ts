import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { isRouteEnabled } from "@/lib/features"

// Pages that were folded into a tabbed parent. Their route files still exist —
// the parent imports them as components — so without this they stayed reachable
// on their own, rendering bare with no tab bar and no way back. Old bookmarks,
// deep links and the command palette all land in the right tab instead.
//
// Insights is deliberately NOT in here. Folding it in meant the sidebar's own
// "Insights" entry bounced into Health & Body, which then highlighted Health &
// Body in the sidebar — so the page you asked for by name appeared under a
// heading you didn't pick, and the nav disagreed with itself about where you
// were. It also filed the correlation engine under the narrowest category it
// draws from: it spans sleep, mood, focus, spending, location and weather, not
// just the body. It stands on its own route now.
const MERGED_ROUTES: Record<string, string> = {
  "/dashboard/medications": "/dashboard/intake?tab=meds",
  // Caffeine's own tab was folded into "In my body", which now leads with it.
  "/dashboard/caffeine":    "/dashboard/intake?tab=body",
  "/dashboard/weight":      "/dashboard/health?tab=weight",
  "/dashboard/body":        "/dashboard/health?tab=body",
  "/dashboard/labs":        "/dashboard/health?tab=labs",
  // Place patterns split in two: correlations joined Insights, trips and the
  // home/away history joined Location. Old links land on the patterns half.
  "/dashboard/location-insights": "/dashboard/insights",
}

// The reverse of the above: the tab is gone, so anything still pointing at it —
// an old bookmark, a shared link — goes to the page rather than to a tab bar
// with nothing behind it.
const RETIRED_TABS: { path: string; tab: string; to: string }[] = [
  { path: "/dashboard/health", tab: "correlations", to: "/dashboard/insights" },
  { path: "/dashboard/intake", tab: "caffeine",     to: "/dashboard/intake?tab=body" },
]

// Held-back V3 features redirect to the dashboard until they launch (see lib/features.ts).
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl

  if (!isRouteEnabled(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl))
  }

  const merged = MERGED_ROUTES[pathname]
  if (merged) {
    return NextResponse.redirect(new URL(merged, req.nextUrl))
  }

  const retired = RETIRED_TABS.find(
    r => r.path === pathname && req.nextUrl.searchParams.get("tab") === r.tab,
  )
  if (retired) {
    return NextResponse.redirect(new URL(retired.to, req.nextUrl))
  }
})

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/sync/:path*",
    "/api/habits/:path*",
    "/api/reminders/:path*",
    "/api/chat/:path*",
    "/api/transactions/:path*",
  ],
}
