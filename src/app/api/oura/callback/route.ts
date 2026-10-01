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
  // Must use the same callback URL that was used to generate the auth URL
  const callbackUrl = new URL("/api/oura/callback", req.url).toString()

  try {
    const tokenResponse = await fetch("https://api.ouraring.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl,
        client_id: process.env.OURA_CLIENT_ID!,
        client_secret: process.env.OURA_CLIENT_SECRET!,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text()
      console.error("[oura/callback] token exchange error:", errorData)
      const reason = errorData.includes("invalid_grant") ? "invalid_grant" : "token_error"
      return settings(req, `oura_error=${reason}`, status)
    }

    const tokens = await tokenResponse.json()

    await prisma.ouraToken.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        scope: tokens.scope ?? null,
      },
      update: {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        scope: tokens.scope ?? null,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[oura/callback] error:", msg)
    return settings(req, "oura_error=db_error", status)
  }

  return settings(req, "oura_connected=1", status)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const userId = verifyState(state)

  if (error || !code || !state || !userId) {
    return settings(req, `oura_error=${encodeURIComponent(error ?? "missing_code")}`)
  }

  const session = await auth()
  const decision = callbackDecision(session?.user?.id, userId)
  if (decision === "mismatch") return settings(req, "oura_error=session_mismatch")
  if (decision === "exchange") return exchangeAndStore(req, code, userId)

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user) return settings(req, "oura_error=missing_code")
  return new Response(
    confirmConnectPage({ provider: "Oura", account: maskEmail(user.email), action: "/api/oura/callback", code, state }),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )
}

// The confirmation page's form. 303 so the browser follows with a GET.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const code = form?.get("code")
  const state = form?.get("state")
  const userId = verifyState(typeof state === "string" ? state : null)
  if (typeof code !== "string" || !code || !userId) return settings(req, "oura_error=missing_code", 303)

  const session = await auth()
  if (callbackDecision(session?.user?.id, userId) === "mismatch") return settings(req, "oura_error=session_mismatch", 303)
  return exchangeAndStore(req, code, userId, 303)
}
