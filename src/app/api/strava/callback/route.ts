import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { verifyState } from "@/lib/state-token"
import { callbackDecision, confirmConnectPage, maskEmail, oauthReturnPath, OAUTH_RETURN_COOKIE } from "@/lib/oauth-callback"

function settings(req: NextRequest, query: string, status?: number) {
  const res = NextResponse.redirect(new URL(oauthReturnPath(req.cookies.get(OAUTH_RETURN_COOKIE)?.value, query), req.url), status)
  res.cookies.delete(OAUTH_RETURN_COOKIE)
  return res
}

async function exchangeAndStore(req: NextRequest, code: string, userId: string, status?: number) {
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
      return settings(req, `strava_error=${reason}`, status)
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
    return settings(req, "strava_error=db_error", status)
  }

  return settings(req, "strava_connected=1", status)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const userId = verifyState(state)

  if (error || !code || !state || !userId) {
    return settings(req, `strava_error=${encodeURIComponent(error ?? "missing_code")}`)
  }

  const session = await auth()
  const decision = callbackDecision(session?.user?.id, userId)
  if (decision === "mismatch") return settings(req, "strava_error=session_mismatch")
  if (decision === "exchange") return exchangeAndStore(req, code, userId)

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user) return settings(req, "strava_error=missing_code")
  return new Response(
    confirmConnectPage({ provider: "Strava", account: maskEmail(user.email), action: "/api/strava/callback", code, state }),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )
}

// The confirmation page's form. 303 so the browser follows with a GET.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const code = form?.get("code")
  const state = form?.get("state")
  const userId = verifyState(typeof state === "string" ? state : null)
  if (typeof code !== "string" || !code || !userId) return settings(req, "strava_error=missing_code", 303)

  const session = await auth()
  if (callbackDecision(session?.user?.id, userId) === "mismatch") return settings(req, "strava_error=session_mismatch", 303)
  return exchangeAndStore(req, code, userId, 303)
}
