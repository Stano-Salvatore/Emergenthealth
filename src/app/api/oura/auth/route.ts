import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { signState } from "@/lib/state-token"

// What we ask Oura for. A scope missing here is a column that stays empty
// forever, and silently: the sync succeeds, the other endpoints return their
// rows, and the one that needed the scope 401s on its own.
//
// That is exactly how cardiovascular age, pulse wave velocity, VO2 max and
// resilience shipped and then never arrived. The endpoints were added, the
// mappers were right, and the two scopes they need were never requested. It
// took putting the refusal on a screen, with Oura's own words attached, to
// find out — the reply was "Token is not authorized access heart_health
// scope."
const OURA_SCOPES = [
  "personal",
  "email",
  "daily",
  "heartrate",
  "workout",
  "session",
  "spo2",
  "tag",
  // daily_cardiovascular_age (vascular age, pulse wave velocity) and vO2_max.
  "heart_health",
  // daily_resilience. daily_stress returns rows without it, which is Oura's
  // line to draw, not ours — ask for it either way.
  "stress",
]

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/signin", req.url))
  }

  // Build callback URL from the actual request so it always matches the registered URI
  const callbackUrl = new URL("/api/oura/callback", req.url).toString()

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.OURA_CLIENT_ID!,
    redirect_uri: callbackUrl,
    scope: OURA_SCOPES.join(" "),
    state: signState(session.user.id),
  })

  const authUrl = `https://cloud.ouraring.com/oauth/authorize?${params.toString()}`

  return NextResponse.redirect(authUrl)
}
