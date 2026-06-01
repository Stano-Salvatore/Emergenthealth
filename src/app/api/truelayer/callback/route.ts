import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyState } from "@/lib/state-token"
import { TL_AUTH, TL_API, ensureTLTable } from "@/lib/truelayer-sync"

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || new URL(req.url).origin
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const userId = verifyState(state)

  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/settings?tl_error=${error}`, req.url))
  }
  if (!code || !userId) {
    const reason = !code ? "missing_code" : "state_invalid"
    return NextResponse.redirect(new URL(`/dashboard/settings?tl_error=${reason}`, req.url))
  }

  const callbackUrl = new URL("/api/truelayer/callback", appOrigin(req)).toString()

  try {
    const tokenRes = await fetch(`${TL_AUTH}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.TRUELAYER_CLIENT_ID!,
        client_secret: process.env.TRUELAYER_CLIENT_SECRET!,
        redirect_uri: callbackUrl,
        code,
      }).toString(),
    })

    if (!tokenRes.ok) {
      console.error("[truelayer/callback] token error:", await tokenRes.text())
      return NextResponse.redirect(new URL("/dashboard/settings?tl_error=token_error", req.url))
    }

    const { access_token, refresh_token, expires_in } = await tokenRes.json()
    const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null

    // Try to grab the first account for auto-selection
    let accountId: string | null = null
    let accountName: string | null = null
    let currency: string | null = null
    try {
      const accRes = await fetch(`${TL_API}/accounts`, {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      if (accRes.ok) {
        const { results } = await accRes.json()
        const first = results?.[0]
        if (first) {
          accountId = first.account_id
          accountName = first.display_name ?? first.account_type ?? null
          currency = first.currency ?? null
        }
      }
    } catch (e) {
      console.error("[truelayer/callback] account fetch failed:", e)
    }

    await ensureTLTable()
    await prisma.$executeRaw`
      INSERT INTO "TruelayerToken"("userId","accessToken","refreshToken","expiresAt","accountId","accountName","currency","updatedAt")
      VALUES (${userId}, ${access_token}, ${refresh_token ?? null}, ${expiresAt}, ${accountId}, ${accountName}, ${currency}, NOW())
      ON CONFLICT("userId") DO UPDATE
        SET "accessToken"  = EXCLUDED."accessToken",
            "refreshToken" = EXCLUDED."refreshToken",
            "expiresAt"    = EXCLUDED."expiresAt",
            "accountId"    = EXCLUDED."accountId",
            "accountName"  = EXCLUDED."accountName",
            "currency"     = EXCLUDED."currency",
            "updatedAt"    = NOW()
    `
  } catch (err: any) {
    console.error("[truelayer/callback] error:", err)
    const reason = encodeURIComponent(String(err?.message ?? "unknown").slice(0, 140))
    return NextResponse.redirect(
      new URL(`/dashboard/settings?tl_error=db_error&tl_reason=${reason}`, req.url)
    )
  }

  return NextResponse.redirect(new URL("/dashboard/settings?tl_connected=1", req.url))
}
