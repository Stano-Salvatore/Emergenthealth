import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyState } from "@/lib/state-token"
import { GC_API, getAccessToken, gcHeaders, ensureGCTable } from "@/lib/gocardless-sync"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ref = searchParams.get("ref")        // requisition id from GoCardless
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/settings?gc_error=${encodeURIComponent(error)}`, req.url))
  }

  const userId = verifyState(state)
  if (!userId) {
    return NextResponse.redirect(new URL("/dashboard/settings?gc_error=state_invalid", req.url))
  }
  if (!ref) {
    return NextResponse.redirect(new URL("/dashboard/settings?gc_error=missing_ref", req.url))
  }

  try {
    await ensureGCTable()
    const token = await getAccessToken()

    // Get accounts from the requisition
    const reqRes = await fetch(`${GC_API}/requisitions/${ref}/`, {
      headers: gcHeaders(token),
    })

    if (!reqRes.ok) {
      console.error("[gocardless/callback] requisition fetch error:", reqRes.status)
      return NextResponse.redirect(new URL("/dashboard/settings?gc_error=requisition_fetch_error", req.url))
    }

    const reqData = await reqRes.json()
    const accountIds: string[] = reqData.accounts ?? []

    // Auto-select first account and fetch its name
    let accountId: string | null = accountIds[0] ?? null
    let accountName: string | null = null
    let currency: string | null = null

    if (accountId) {
      try {
        const detailRes = await fetch(`${GC_API}/accounts/${accountId}/details/`, {
          headers: gcHeaders(token),
        })
        if (detailRes.ok) {
          const { account } = await detailRes.json()
          accountName = account?.name ?? account?.product ?? account?.ownerName ?? null
          currency = account?.currency ?? null
        }
      } catch (e) {
        console.error("[gocardless/callback] account detail fetch failed:", e)
      }
    }

    await prisma.$executeRaw`
      INSERT INTO "GocardlessConnection"("userId","requisitionId","accountId","accountName","currency","updatedAt")
      VALUES (${userId}, ${ref}, ${accountId}, ${accountName}, ${currency}, NOW())
      ON CONFLICT("userId") DO UPDATE
        SET "requisitionId" = EXCLUDED."requisitionId",
            "accountId"     = EXCLUDED."accountId",
            "accountName"   = EXCLUDED."accountName",
            "currency"      = EXCLUDED."currency",
            "updatedAt"     = NOW()
    `
  } catch (err: unknown) {
    console.error("[gocardless/callback] error:", err)
    const reason = encodeURIComponent(String((err as Error)?.message ?? "unknown").slice(0, 140))
    return NextResponse.redirect(
      new URL(`/dashboard/settings?gc_error=db_error&gc_reason=${reason}`, req.url)
    )
  }

  return NextResponse.redirect(new URL("/dashboard/settings?gc_connected=1", req.url))
}
