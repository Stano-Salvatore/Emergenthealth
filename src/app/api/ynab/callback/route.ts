import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyState } from "@/lib/state-token"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "YnabToken" (
      "userId"       TEXT NOT NULL PRIMARY KEY,
      "accessToken"  TEXT NOT NULL,
      "refreshToken" TEXT,
      "expiresAt"    TIMESTAMPTZ,
      "budgetId"     TEXT,
      "budgetName"   TEXT,
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Upgrade from PAT-only schema if columns are missing
  await prisma.$executeRaw`ALTER TABLE "YnabToken" ADD COLUMN IF NOT EXISTS "refreshToken" TEXT`
  await prisma.$executeRaw`ALTER TABLE "YnabToken" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMPTZ`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const userId = verifyState(state)

  if (error || !code || !userId) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings?ynab_error=${error ?? "missing_code"}`, req.url)
    )
  }

  const callbackUrl = new URL("/api/ynab/callback", req.url).toString()

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

    // Pick most recently modified budget
    const budgetRes = await fetch(
      "https://api.youneedabudget.com/v1/budgets?include_accounts=false",
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const { data } = await budgetRes.json()
    const budgets: { id: string; name: string; last_modified_on: string }[] = data.budgets ?? []
    const chosen = budgets.sort((a, b) =>
      b.last_modified_on.localeCompare(a.last_modified_on)
    )[0]

    await ensureTable()
    await prisma.$executeRaw`
      INSERT INTO "YnabToken"("userId","accessToken","refreshToken","expiresAt","budgetId","budgetName","updatedAt")
      VALUES (
        ${userId},
        ${access_token},
        ${refresh_token ?? null},
        ${expiresAt},
        ${chosen?.id ?? null},
        ${chosen?.name ?? null},
        NOW()
      )
      ON CONFLICT("userId") DO UPDATE
        SET "accessToken"  = EXCLUDED."accessToken",
            "refreshToken" = EXCLUDED."refreshToken",
            "expiresAt"    = EXCLUDED."expiresAt",
            "budgetId"     = EXCLUDED."budgetId",
            "budgetName"   = EXCLUDED."budgetName",
            "updatedAt"    = NOW()
    `
  } catch (err) {
    console.error("[ynab/callback] error:", err)
    return NextResponse.redirect(
      new URL("/dashboard/settings?ynab_error=db_error", req.url)
    )
  }

  return NextResponse.redirect(new URL("/dashboard/settings?ynab_connected=1", req.url))
}
