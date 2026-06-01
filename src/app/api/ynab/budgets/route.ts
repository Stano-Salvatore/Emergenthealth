import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await prisma.$queryRaw<{ accessToken: string }[]>`
    SELECT "accessToken" FROM "YnabToken" WHERE "userId" = ${session.user.id}
  `.catch(() => [] as { accessToken: string }[])

  if (!rows[0]?.accessToken) return NextResponse.json({ error: "YNAB not connected" }, { status: 400 })

  const res = await fetch("https://api.youneedabudget.com/v1/budgets?include_accounts=false", {
    headers: { Authorization: `Bearer ${rows[0].accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text()
    console.error("[ynab/budgets] API error:", res.status, body)
    return NextResponse.json({ error: `YNAB error (${res.status})` }, { status: 502 })
  }

  const { data } = await res.json()
  const budgets = ((data?.budgets ?? []) as { id: string; name: string; last_modified_on: string }[])
    .sort((a, b) => (b.last_modified_on ?? "").localeCompare(a.last_modified_on ?? ""))
    .map(b => ({ id: b.id, name: b.name }))

  return NextResponse.json({ budgets })
}
