import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { buildFitOAuthClient } from "@/lib/google-fit"

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

  const oauth2 = buildFitOAuthClient()
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: FIT_SCOPES,
    state: session.user.id,
  })

  return NextResponse.redirect(url)
}
