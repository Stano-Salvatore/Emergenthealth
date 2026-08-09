import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { isRouteEnabled } from "@/lib/features"

// Pages that were folded into a tabbed parent. Their route files still exist —
// the parent imports them as components — so without this they stayed reachable
// on their own, rendering bare with no tab bar and no way back. Old bookmarks,
// deep links and the command palette all land in the right tab instead.
const MERGED_ROUTES: Record<string, string> = {
  "/dashboard/medications": "/dashboard/intake?tab=meds",
  "/dashboard/caffeine":    "/dashboard/intake?tab=caffeine",
  "/dashboard/weight":      "/dashboard/health?tab=weight",
  "/dashboard/body":        "/dashboard/health?tab=body",
  "/dashboard/insights":    "/dashboard/health?tab=correlations",
  "/dashboard/labs":        "/dashboard/health?tab=labs",
}

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
