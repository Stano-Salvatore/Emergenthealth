import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyState } from "@/lib/state-token"

function appOrigin(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    new URL(req.url).origin
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const userId = verifyState(state)

  if (error) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings?ynab_error=${error}`, req.url)
    )
  }
  if (!code || !userId) {
    const reason = !code ? "missing_code" : "state_invalid"
    return NextResponse.redirect(
      new URL(`/dashboard/settings?ynab_error=${reason}`, req.url)
    )
  }

  const callbackUrl = new URL("/api/ynab/callback", appOrigin(req)).toString()

  try {
    const tokenRes = await fetch("https://api.youneedabudget.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.YNAB_CLIENT_ID!,
        client_secret: process.env.YNAB_CLIENT_SECRET!,
        redirect_uri: callbackUrl,
        code,
      }).toString(),
    })

    if (!tokenRes.ok) {
      console.error("[ynab/callback] token exchange error:", await tokenRes.text())
      return NextResponse.redirect(
        new URL("/dashboard/settings?ynab_error=token_error", req.url)
      )
    }

    const { access_token, refresh_token, expires_in } = await tokenRes.json()
    const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null

    let chosen: { id: string; name: string } | undefined
    try {
      const budgetRes = await fetch(
        "https://api.youneedabudget.com/v1/budgets?include_accounts=false",
        { headers: { Authorization: `Bearer ${access_token}` } }
      )
      if (budgetRes.ok) {
        const { data } = await budgetRes.json()
        const budgets: { id: string; name: string; last_modified_on: string }[] = data?.budgets ?? []
        chosen = budgets.sort((a, b) =>
          (b.last_modified_on ?? "").localeCompare(a.last_modified_on ?? "")
        )[0]
      } else {
        console.error("[ynab/callback] budget fetch failed:", budgetRes.status, await budgetRes.text())
      }
    } catch (e) {
      console.error("[ynab/callback] budget fetch threw:", e)
    }

    await prisma.ynabToken.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: access_token,
        refreshToken: refresh_token ?? null,
        expiresAt,
        budgetId: chosen?.id ?? null,
        budgetName: chosen?.name ?? null,
      },
      update: {
        accessToken: access_token,
        refreshToken: refresh_token ?? null,
        expiresAt,
        budgetId: chosen?.id ?? null,
        budgetName: chosen?.name ?? null,
        updatedAt: new Date(),
      },
    })
  } catch (err: any) {
    console.error("[ynab/callback] error:", err)
    const reason = encodeURIComponent(String(err?.message ?? "unknown").slice(0, 140))
    return NextResponse.redirect(
      new URL(`/dashboard/settings?ynab_error=db_error&ynab_reason=${reason}`, req.url)
    )
  }

  return NextResponse.redirect(new URL("/dashboard/settings?ynab_connected=1", req.url))
}
