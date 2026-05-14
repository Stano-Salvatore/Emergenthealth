import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { google } from "googleapis"

const FIT_SCOPES = [
  "https://www.googleapis.com/auth/fitness.activity.read",
  "https://www.googleapis.com/auth/fitness.body.read",
  "https://www.googleapis.com/auth/fitness.heart_rate.read",
  "https://www.googleapis.com/auth/fitness.sleep.read",
  "https://www.googleapis.com/auth/fitness.nutrition.read",
  "https://www.googleapis.com/auth/fitness.location.read",
]

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/signin", req.url))
  }

  // Build callback URL from the actual request so it always matches the registered URI
  const callbackUrl = new URL("/api/mcp/fit-auth/callback", req.url).toString()

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_FIT_CLIENT_ID,
    process.env.GOOGLE_FIT_CLIENT_SECRET,
    callbackUrl,
  )

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: FIT_SCOPES,
    state: session.user.id,
  })

  return NextResponse.redirect(url)
}
