import { NextRequest, NextResponse } from "next/server"
import { buildFitOAuthClient } from "@/lib/google-fit"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const userId = searchParams.get("state")
  const error = searchParams.get("error")

  if (error || !code || !userId) {
    return NextResponse.redirect(
      new URL(`/dashboard/health?fit_error=${error ?? "missing_code"}`, req.url),
    )
  }

  const oauth2 = buildFitOAuthClient()
  const { tokens } = await oauth2.getToken(code)

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

  return NextResponse.redirect(new URL("/dashboard/health?fit_connected=1", req.url))
}
