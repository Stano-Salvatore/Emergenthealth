import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { signState } from "@/lib/state-token"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/signin", req.url))
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
  return NextResponse.redirect(authUrl)
}
