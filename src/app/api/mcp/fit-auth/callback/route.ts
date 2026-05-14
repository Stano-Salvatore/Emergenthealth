import { NextRequest, NextResponse } from "next/server"
import { google } from "googleapis"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const userId = searchParams.get("state")
  const error = searchParams.get("error")

  if (error || !code || !userId) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings?fit_error=${error ?? "missing_code"}`, req.url),
    )
  }

  // Must use the same callback URL that was used to generate the auth URL
  const callbackUrl = new URL("/api/mcp/fit-auth/callback", req.url).toString()

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_FIT_CLIENT_ID,
    process.env.GOOGLE_FIT_CLIENT_SECRET,
    callbackUrl,
  )

  let tokens: Awaited<ReturnType<typeof oauth2.getToken>>["tokens"]
  try {
    const result = await oauth2.getToken(code)
    tokens = result.tokens
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[fit-auth/callback] getToken error:", msg)
    const reason = msg.includes("invalid_grant") ? "invalid_grant" : "token_error"
    return NextResponse.redirect(new URL(`/dashboard/settings?fit_error=${reason}`, req.url))
  }

  try {
    await prisma.fitToken.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope ?? null,
      },
      update: {
        accessToken: tokens.access_token!,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope ?? null,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[fit-auth/callback] prisma.fitToken.upsert error:", msg)
    return NextResponse.redirect(new URL(`/dashboard/settings?fit_error=db_error`, req.url))
  }

  return NextResponse.redirect(new URL("/dashboard/settings?fit_connected=1", req.url))
}
