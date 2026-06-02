import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { signState } from "@/lib/state-token"
import { SE_API, seHeaders, ensureSETable, getOrCreateCustomer } from "@/lib/saltedge-sync"
import { prisma } from "@/lib/prisma"

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || new URL(req.url).origin
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.redirect(new URL("/signin", req.url))

  const origin = appOrigin(req)
  const state = signState(session.user.id)
  const returnTo = new URL(`/api/saltedge/callback?state=${encodeURIComponent(state)}`, origin).toString()

  try {
    await ensureSETable()
    const customerId = await getOrCreateCustomer(session.user.id)

    // Upsert row with customerId so we have it for later
    await prisma.$executeRaw`
      INSERT INTO "SaltedgeConnection"("userId","customerId","updatedAt")
      VALUES (${session.user.id}, ${customerId}, NOW())
      ON CONFLICT("userId") DO UPDATE
        SET "customerId" = EXCLUDED."customerId", "updatedAt" = NOW()
    `

    const since = new Date()
    since.setDate(since.getDate() - 60)
    const fromDate = since.toISOString().slice(0, 10)

    const sessionRes = await fetch(`${SE_API}/connect_sessions/create`, {
      method: "POST",
      headers: seHeaders(),
      body: JSON.stringify({
        data: {
          customer_id: customerId,
          consent: {
            scopes: ["account_details", "transactions_details"],
            from_date: fromDate,
          },
          attempt: {
            return_to: returnTo,
            fetch_scopes: ["accounts", "transactions"],
          },
        },
      }),
    })

    if (!sessionRes.ok) {
      const errBody = await sessionRes.text()
      console.error("[saltedge/auth] connect session error:", sessionRes.status, errBody)
      return NextResponse.redirect(new URL("/dashboard/settings?se_error=session_error", req.url))
    }

    const { data } = await sessionRes.json()
    return NextResponse.redirect(data.connect_url as string)
  } catch (err: unknown) {
    console.error("[saltedge/auth] error:", err)
    return NextResponse.redirect(new URL("/dashboard/settings?se_error=auth_error", req.url))
  }
}
