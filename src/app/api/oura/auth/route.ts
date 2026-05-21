import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

const OURA_SCOPES = [
  "personal",
  "email",
  "daily",
  "heartrate",
  "workout",
  "session",
  "spo2",
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
    state: session.user.id,
  })

  const authUrl = `https://cloud.ouraring.com/oauth/authorize?${params.toString()}`

  return NextResponse.redirect(authUrl)
}
