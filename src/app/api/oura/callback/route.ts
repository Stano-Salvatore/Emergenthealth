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
      new URL(`/dashboard/settings?oura_error=${error ?? "missing_code"}`, req.url),
    )
  }

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
      return NextResponse.redirect(new URL(`/dashboard/settings?oura_error=${reason}`, req.url))
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
    return NextResponse.redirect(new URL(`/dashboard/settings?oura_error=db_error`, req.url))
  }

  return NextResponse.redirect(new URL("/dashboard/settings?oura_connected=1", req.url))
}
