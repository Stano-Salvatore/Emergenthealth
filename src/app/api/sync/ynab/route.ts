import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 60

interface YnabTransaction {
  id: string
  date: string
  amount: number          // milliunits (1000 = €1.00)
  memo: string | null
  cleared: string
  approved: boolean
  payee_name: string | null
  category_name: string | null
  category_group_name: string | null
  account_name: string
  transfer_account_id: string | null
  deleted: boolean
}

interface TokenRow {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  budgetId: string
}

async function getFreshToken(userId: string, row: TokenRow): Promise<string> {
  if (!row.refreshToken) return row.accessToken
  if (row.expiresAt && row.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return row.accessToken
  }

  const res = await fetch("https://api.youneedabudget.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.YNAB_CLIENT_ID!,
      client_secret: process.env.YNAB_CLIENT_SECRET!,
      refresh_token: row.refreshToken,
    }).toString(),
  })

  if (!res.ok) {
    console.error("[sync/ynab] token refresh failed:", res.status)
    return row.accessToken
  }

  const { access_token, refresh_token, expires_in } = await res.json()
  const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null

  await prisma.$executeRaw`
    UPDATE "YnabToken"
    SET "accessToken"  = ${access_token},
        "refreshToken" = ${refresh_token ?? row.refreshToken},
        "expiresAt"    = ${expiresAt},
        "updatedAt"    = NOW()
    WHERE "userId" = ${userId}
  `
  return access_token
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const rows = await prisma.$queryRaw<TokenRow[]>`
    SELECT "accessToken","refreshToken","expiresAt","budgetId"
    FROM "YnabToken" WHERE "userId" = ${userId}
  `.catch(() => [])

  if (!rows[0]) return NextResponse.json({ error: "YNAB not connected" }, { status: 400 })
  const accessToken = await getFreshToken(userId, rows[0])
  const { budgetId } = rows[0]

  // Sync last 60 days
  const since = new Date()
  since.setDate(since.getDate() - 60)
  const sinceDate = since.toISOString().split("T")[0]

  const res = await fetch(
    `https://api.youneedabudget.com/v1/budgets/${budgetId}/transactions?since_date=${sinceDate}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) {
    const body = await res.text()
    console.error("[sync/ynab] YNAB API error:", res.status, body)
    if (res.status === 401) {
      return NextResponse.json({ error: "YNAB token expired — reconnect in Settings" }, { status: 401 })
    }
    return NextResponse.json({ error: `YNAB API error (${res.status})` }, { status: 502 })
  }

  const { data } = await res.json()
  const txns: YnabTransaction[] = data.transactions ?? []

  let synced = 0
  let deleted = 0

  try {
    for (const t of txns) {
      if (t.deleted) {
        await prisma.transaction.deleteMany({ where: { userId, actualId: `ynab_${t.id}` } })
        deleted++
        continue
      }

      // YNAB amounts: milliunits. Divide by 10 → cents (stored as Int cents).
      const amountCents = Math.round(t.amount / 10)
      const dateObj = new Date(t.date + "T12:00:00Z")

      await prisma.transaction.upsert({
        where: { actualId: `ynab_${t.id}` },
        create: {
          userId,
          actualId: `ynab_${t.id}`,
          date: dateObj,
          amount: amountCents,
          payee: t.payee_name ?? null,
          category: t.category_name ?? null,
          categoryGroup: t.category_group_name ?? null,
          accountName: t.account_name ?? null,
          notes: t.memo ?? null,
          cleared: t.cleared === "cleared" || t.cleared === "reconciled",
          isTransfer: !!t.transfer_account_id,
        },
        update: {
          date: dateObj,
          amount: amountCents,
          payee: t.payee_name ?? null,
          category: t.category_name ?? null,
          categoryGroup: t.category_group_name ?? null,
          notes: t.memo ?? null,
          cleared: t.cleared === "cleared" || t.cleared === "reconciled",
          syncedAt: new Date(),
        },
      })
      synced++
    }
  } catch (err: any) {
    console.error("[sync/ynab] DB error after", synced, "transactions:", err)
    return NextResponse.json({ error: `DB error: ${err.message}`, synced }, { status: 500 })
  }

  return NextResponse.json({ success: true, synced, deleted })
}
