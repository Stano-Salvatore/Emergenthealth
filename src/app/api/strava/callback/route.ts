import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyState } from "@/lib/state-token"
import { ensureStravaTable } from "@/lib/strava"

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

    await ensureStravaTable()

    const athleteId = tokens.athlete?.id != null ? String(tokens.athlete.id) : null
    const expiresAt = BigInt(tokens.expires_at)

    await prisma.$executeRaw`
      INSERT INTO "StravaToken" ("userId", "accessToken", "refreshToken", "expiresAt", "athleteId", "updatedAt")
      VALUES (${userId}, ${tokens.access_token}, ${tokens.refresh_token}, ${expiresAt}, ${athleteId}, NOW())
      ON CONFLICT ("userId") DO UPDATE
        SET "accessToken"  = EXCLUDED."accessToken",
            "refreshToken" = EXCLUDED."refreshToken",
            "expiresAt"    = EXCLUDED."expiresAt",
            "athleteId"    = EXCLUDED."athleteId",
            "updatedAt"    = NOW()
    `
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[strava/callback] error:", msg)
    return NextResponse.redirect(new URL("/dashboard/settings?strava_error=db_error", req.url))
  }

  return NextResponse.redirect(new URL("/dashboard/settings?strava_connected=1", req.url))
}
