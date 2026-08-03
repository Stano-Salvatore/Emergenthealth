import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { isRouteEnabled } from "@/lib/features"

// Held-back V3 features redirect to the dashboard until they launch (see lib/features.ts).
export const proxy = auth((req) => {
  if (!isRouteEnabled(req.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl))
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
