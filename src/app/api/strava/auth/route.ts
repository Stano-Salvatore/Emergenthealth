import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { signState } from "@/lib/state-token"
import { OAUTH_RETURN_COOKIE } from "@/lib/oauth-callback"
import { stravaOffered } from "@/lib/strava-access"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/signin", req.url))
  }

  // Not past Strava's athlete limit: say so here rather than send the user to
  // Strava's 403 page (lib/strava-access).
  if (!(await stravaOffered(session.user.id))) {
    const back = req.nextUrl.searchParams.get("return") === "onboarding" ? "/onboarding?step=connect" : "/dashboard/settings"
    const url = new URL(back, req.url)
    url.searchParams.set("strava_error", "closed")
    return NextResponse.redirect(url)
  }

  const callbackUrl = new URL("/api/strava/callback", req.url).toString()

  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "activity:read_all",
    state: signState(session.user.id),
  })

  const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`
  const res = NextResponse.redirect(authUrl)
  // Started from the onboarding wizard: come back to it, not to Settings.
  if (req.nextUrl.searchParams.get("return") === "onboarding") {
    res.cookies.set(OAUTH_RETURN_COOKIE, "onboarding", { httpOnly: true, sameSite: "lax", maxAge: 900, path: "/" })
  }
  return res
}
