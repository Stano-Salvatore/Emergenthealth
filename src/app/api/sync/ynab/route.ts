import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 60

const CATEGORY_MAP: Record<string, string> = {
  // Food
  "food & dining": "Food & Drink", "dining out": "Food & Drink", "restaurants": "Food & Drink",
  "groceries": "Food & Drink", "food & drink": "Food & Drink", "coffee shops": "Food & Drink",
  "fast food": "Food & Drink", "alcohol & bars": "Food & Drink",
  // Transport
  "transportation": "Transport", "auto & transport": "Transport", "gas & fuel": "Transport",
  "parking": "Transport", "public transportation": "Transport", "taxi": "Transport",
  "uber": "Transport", "lyft": "Transport", "petrol": "Transport", "transport": "Transport",
  // Shopping
  "shopping": "Shopping", "clothing": "Shopping", "electronics & software": "Shopping",
  "amazon": "Shopping", "home": "Shopping",
  // Entertainment
  "entertainment": "Entertainment", "movies & dvds": "Entertainment", "music": "Entertainment",
  "games": "Entertainment", "netflix": "Entertainment", "spotify": "Entertainment",
  "streaming": "Entertainment", "hobbies": "Entertainment",
  // Health
  "health & fitness": "Health", "health": "Health", "pharmacy": "Health",
  "doctor": "Health", "medical": "Health", "gym": "Health", "sports": "Health",
  // Bills & Utilities
  "bills & utilities": "Bills & Utilities", "utilities": "Bills & Utilities",
  "internet": "Bills & Utilities", "mobile phone": "Bills & Utilities",
  "phone": "Bills & Utilities", "insurance": "Bills & Utilities",
  "subscriptions": "Bills & Utilities", "electricity": "Bills & Utilities",
  "gas & electric": "Bills & Utilities",
  // Housing
  "housing": "Housing", "rent & mortgage": "Housing", "mortgage & rent": "Housing",
  "home improvement": "Housing", "rent": "Housing",
  // Income
  "income": "Income", "salary": "Income", "wages": "Income",
  "freelance": "Income", "paycheck": "Income", "inflow": "Income",
}

function mapCategory(categoryName: string | null, categoryGroupName: string | null): string {
  const candidates = [categoryName, categoryGroupName].filter(Boolean) as string[]
  for (const c of candidates) {
    const match = CATEGORY_MAP[c.toLowerCase()]
    if (match) return match
  }
  return "Other"
}

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
  let { budgetId } = rows[0]

  // Budget ID missing (e.g. budget fetch failed during OAuth callback) — resolve it now
  if (!budgetId) {
    try {
      const budgetRes = await fetch(
        "https://api.youneedabudget.com/v1/budgets?include_accounts=false",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (budgetRes.ok) {
        const { data } = await budgetRes.json()
        const budgets: { id: string; name: string; last_modified_on: string }[] = data?.budgets ?? []
        const chosen = budgets.sort((a, b) =>
          (b.last_modified_on ?? "").localeCompare(a.last_modified_on ?? "")
        )[0]
        if (chosen) {
          budgetId = chosen.id
          await prisma.$executeRaw`
            UPDATE "YnabToken"
            SET "budgetId" = ${chosen.id}, "budgetName" = ${chosen.name}, "updatedAt" = NOW()
            WHERE "userId" = ${userId}
          `
        }
      }
    } catch (e) {
      console.error("[sync/ynab] budget resolve failed:", e)
    }
    if (!budgetId) {
      return NextResponse.json({ error: "No YNAB budget found — please reconnect in Settings" }, { status: 400 })
    }
  }

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

      const mappedCategory = t.amount > 0
        ? "Income"
        : mapCategory(t.category_name, t.category_group_name)

      await prisma.transaction.upsert({
        where: { actualId: `ynab_${t.id}` },
        create: {
          userId,
          actualId: `ynab_${t.id}`,
          date: dateObj,
          amount: amountCents,
          payee: t.payee_name ?? null,
          category: mappedCategory,
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
          category: mappedCategory,
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
