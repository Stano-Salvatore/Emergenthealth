import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { TL_API } from "@/lib/truelayer-sync"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await prisma.$queryRaw<{ accessToken: string }[]>`
    SELECT "accessToken" FROM "TruelayerToken" WHERE "userId" = ${session.user.id}
  `.catch(() => [])

  if (!rows[0]?.accessToken) return NextResponse.json({ error: "Not connected" }, { status: 400 })

  const res = await fetch(`${TL_API}/accounts`, {
    headers: { Authorization: `Bearer ${rows[0].accessToken}` },
  })

  if (!res.ok) {
    console.error("[truelayer/accounts] error:", res.status)
    return NextResponse.json({ error: `TrueLayer error (${res.status})` }, { status: 502 })
  }

  const { results } = await res.json()
  const accounts = (results ?? []).map((a: {
    account_id: string
    display_name?: string
    account_type?: string
    currency?: string
  }) => ({
    id: a.account_id,
    name: a.display_name ?? a.account_type ?? "Account",
    currency: a.currency ?? "",
  }))

  return NextResponse.json({ accounts })
}
