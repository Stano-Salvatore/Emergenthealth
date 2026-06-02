import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GC_API, getAccessToken, gcHeaders } from "@/lib/gocardless-sync"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await prisma.$queryRaw<{ requisitionId: string | null }[]>`
    SELECT "requisitionId" FROM "GocardlessConnection" WHERE "userId" = ${session.user.id}
  `.catch(() => [])

  const requisitionId = rows[0]?.requisitionId
  if (!requisitionId) return NextResponse.json({ error: "Not connected" }, { status: 400 })

  try {
    const token = await getAccessToken()

    const reqRes = await fetch(`${GC_API}/requisitions/${requisitionId}/`, {
      headers: gcHeaders(token),
    })
    if (!reqRes.ok) return NextResponse.json({ error: `GoCardless error (${reqRes.status})` }, { status: 502 })

    const reqData = await reqRes.json()
    const accountIds: string[] = reqData.accounts ?? []

    const accounts = await Promise.all(
      accountIds.map(async (id) => {
        try {
          const detailRes = await fetch(`${GC_API}/accounts/${id}/details/`, {
            headers: gcHeaders(token),
          })
          if (!detailRes.ok) return { id, name: "Account", currency: "" }
          const { account } = await detailRes.json()
          return {
            id,
            name: account?.name ?? account?.product ?? account?.ownerName ?? "Account",
            currency: account?.currency ?? "",
          }
        } catch {
          return { id, name: "Account", currency: "" }
        }
      })
    )

    return NextResponse.json({ accounts })
  } catch (err: unknown) {
    console.error("[gocardless/accounts] error:", err)
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 502 })
  }
}
