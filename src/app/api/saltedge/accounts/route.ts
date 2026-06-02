import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { SE_API, seHeaders } from "@/lib/saltedge-sync"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await prisma.$queryRaw<{ connectionId: string | null }[]>`
    SELECT "connectionId" FROM "SaltedgeConnection" WHERE "userId" = ${session.user.id}
  `.catch(() => [])

  const connectionId = rows[0]?.connectionId
  if (!connectionId) return NextResponse.json({ error: "Not connected" }, { status: 400 })

  const res = await fetch(`${SE_API}/accounts?connection_id=${connectionId}`, {
    headers: seHeaders(),
  })

  if (!res.ok) {
    console.error("[saltedge/accounts] error:", res.status)
    return NextResponse.json({ error: `Salt Edge error (${res.status})` }, { status: 502 })
  }

  const { data } = await res.json()
  const accounts = (Array.isArray(data) ? data : []).map((a: {
    id: string
    name?: string
    nature?: string
    currency_code?: string
  }) => ({
    id: a.id,
    name: a.name ?? a.nature ?? "Account",
    currency: a.currency_code ?? "",
  }))

  return NextResponse.json({ accounts })
}
