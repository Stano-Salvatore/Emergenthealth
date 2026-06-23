import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyState } from "@/lib/state-token"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const userId = verifyState(state)

  if (error || !code || !userId) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings?strava_error=${error ?? "missing_code"}`, req.url),
    )
  }

  const callbackUrl = new URL("/api/strava/callback", req.url).toString()

  try {
    const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.STRAVA_CLIENT_ID!,
        client_secret: process.env.STRAVA_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text()
      console.error("[strava/callback] token exchange error:", errorData)
      const reason = errorData.includes("invalid_grant") ? "invalid_grant" : "token_error"
      return NextResponse.redirect(new URL(`/dashboard/settings?strava_error=${reason}`, req.url))
    }

    const tokens = await tokenResponse.json()
    const athleteId = tokens.athlete?.id != null ? String(tokens.athlete.id) : null

    await prisma.stravaToken.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.access_token as string,
        refreshToken: tokens.refresh_token as string,
        expiresAt: BigInt(tokens.expires_at as number),
        athleteId,
      },
      update: {
        accessToken: tokens.access_token as string,
        refreshToken: tokens.refresh_token as string,
        expiresAt: BigInt(tokens.expires_at as number),
        athleteId,
        updatedAt: new Date(),
      },
    })
  } catch (err: unknown) {
    console.error("[strava/callback] error:", err instanceof Error ? err.message : String(err))
    return NextResponse.redirect(new URL("/dashboard/settings?strava_error=db_error", req.url))
  }

  return NextResponse.redirect(new URL("/dashboard/settings?strava_connected=1", req.url))
}
