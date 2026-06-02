import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyState } from "@/lib/state-token"
import { SE_API, seHeaders, ensureSETable } from "@/lib/saltedge-sync"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const connectionId = searchParams.get("connection_id")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/settings?se_error=${encodeURIComponent(error)}`, req.url))
  }

  const userId = verifyState(state)
  if (!userId) {
    return NextResponse.redirect(new URL("/dashboard/settings?se_error=state_invalid", req.url))
  }
  if (!connectionId) {
    return NextResponse.redirect(new URL("/dashboard/settings?se_error=missing_connection", req.url))
  }

  try {
    await ensureSETable()

    // Fetch accounts to auto-select the first one
    let accountId: string | null = null
    let accountName: string | null = null
    let currency: string | null = null
    try {
      const accRes = await fetch(`${SE_API}/accounts?connection_id=${connectionId}`, {
        headers: seHeaders(),
      })
      if (accRes.ok) {
        const { data } = await accRes.json()
        const first = Array.isArray(data) ? data[0] : null
        if (first) {
          accountId = first.id
          accountName = first.name ?? first.nature ?? null
          currency = first.currency_code ?? null
        }
      }
    } catch (e) {
      console.error("[saltedge/callback] account fetch failed:", e)
    }

    await prisma.$executeRaw`
      UPDATE "SaltedgeConnection"
      SET "connectionId" = ${connectionId},
          "accountId"    = ${accountId},
          "accountName"  = ${accountName},
          "currency"     = ${currency},
          "updatedAt"    = NOW()
      WHERE "userId" = ${userId}
    `
  } catch (err: unknown) {
    console.error("[saltedge/callback] error:", err)
    const reason = encodeURIComponent(String((err as Error)?.message ?? "unknown").slice(0, 140))
    return NextResponse.redirect(
      new URL(`/dashboard/settings?se_error=db_error&se_reason=${reason}`, req.url)
    )
  }

  return NextResponse.redirect(new URL("/dashboard/settings?se_connected=1", req.url))
}
