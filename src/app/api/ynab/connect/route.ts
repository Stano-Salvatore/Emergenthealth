import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "YnabToken" (
      "userId"      TEXT NOT NULL PRIMARY KEY,
      "accessToken" TEXT NOT NULL,
      "budgetId"    TEXT,
      "budgetName"  TEXT,
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { accessToken, budgetId } = await req.json()
  if (!accessToken?.trim()) return NextResponse.json({ error: "accessToken required" }, { status: 400 })

  // Verify token + fetch budgets
  const res = await fetch("https://api.youneedabudget.com/v1/budgets?include_accounts=false", {
    headers: { Authorization: `Bearer ${accessToken.trim()}` },
  })
  if (!res.ok) return NextResponse.json({ error: "Invalid YNAB token" }, { status: 400 })

  const { data } = await res.json()
  const budgets: { id: string; name: string; last_modified_on: string }[] = data.budgets ?? []
  if (budgets.length === 0) return NextResponse.json({ error: "No budgets found" }, { status: 400 })

  // Pick the requested budget or the most recently modified one
  const chosen = budgetId
    ? budgets.find(b => b.id === budgetId) ?? budgets[0]
    : budgets.sort((a, b) => b.last_modified_on.localeCompare(a.last_modified_on))[0]

  await ensureTable()
  await prisma.$executeRaw`
    INSERT INTO "YnabToken"("userId","accessToken","budgetId","budgetName","updatedAt")
    VALUES (${userId}, ${accessToken.trim()}, ${chosen.id}, ${chosen.name}, NOW())
    ON CONFLICT("userId") DO UPDATE
      SET "accessToken"=${accessToken.trim()}, "budgetId"=${chosen.id}, "budgetName"=${chosen.name}, "updatedAt"=NOW()
  `

  return NextResponse.json({ ok: true, budgetId: chosen.id, budgetName: chosen.name, budgets })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await ensureTable()
  await prisma.$executeRaw`DELETE FROM "YnabToken" WHERE "userId" = ${session.user.id}`
  return NextResponse.json({ ok: true })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ connected: false }, { status: 401 })
  await ensureTable()
  const rows = await prisma.$queryRaw<{ budgetId: string; budgetName: string }[]>`
    SELECT "budgetId","budgetName" FROM "YnabToken" WHERE "userId" = ${session.user.id}
  `
  if (!rows[0]) return NextResponse.json({ connected: false })
  return NextResponse.json({ connected: true, budgetId: rows[0].budgetId, budgetName: rows[0].budgetName })
}
