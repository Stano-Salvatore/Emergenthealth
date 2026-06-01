import { prisma } from "@/lib/prisma"

export const TL_AUTH = process.env.TRUELAYER_SANDBOX === "true"
  ? "https://auth.truelayer-sandbox.com"
  : "https://auth.truelayer.com"
export const TL_API = process.env.TRUELAYER_SANDBOX === "true"
  ? "https://api.truelayer-sandbox.com/data/v1"
  : "https://api.truelayer.com/data/v1"

// TrueLayer transaction_category → app category
const TL_CATEGORY_MAP: Record<string, string> = {
  ATM: "Cash", CASH: "Cash",
  BILL_PAYMENT: "Bills & Utilities", DIRECT_DEBIT: "Bills & Utilities", STANDING_ORDER: "Bills & Utilities",
  CREDIT: "Income", CASHBACK: "Income", DIVIDEND: "Income", INTEREST: "Income",
  TRANSFER: "Transfer", DEBIT: "Other", FEE_CHARGE: "Other", OTHER: "Other",
}

// Keyword fallback when category is PURCHASE or OTHER
const MERCHANT_KEYWORD_MAP: [RegExp, string][] = [
  [/revolut|transfer|topup/i, "Transfer"],
  [/grocery|supermarket|tesco|lidl|kaufland|albert|billa|coop|biedronka|zabka/i, "Food & Drink"],
  [/restaurant|cafe|coffee|starbucks|mcdonald|burger|pizza|kfc|subway|pub|bar/i, "Food & Drink"],
  [/uber|bolt|taxi|lyft|train|metro|bus|mhd|cp\.sk|slovak rail/i, "Transport"],
  [/fuel|petrol|benzin|shell|eni|lotos|orlen/i, "Transport"],
  [/netflix|spotify|youtube|prime|disney|hbo|apple\.com\/bill/i, "Entertainment"],
  [/amazon|aliexpress|mall\.sk|heureka|alza|ikea|zara|hm\b/i, "Shopping"],
  [/rent|mortgage|nájom/i, "Housing"],
  [/gym|fitness|sport|swimming|pool/i, "Health"],
  [/doctor|pharmacy|lekaren|lekár|medical|hospital/i, "Health"],
  [/insurance|allianz|uniqa|generali/i, "Bills & Utilities"],
  [/salary|payroll|mzda|výplata/i, "Income"],
]

function mapCategory(tlCategory: string | null, merchantName: string | null, description: string | null): string {
  if (tlCategory && TL_CATEGORY_MAP[tlCategory] && tlCategory !== "PURCHASE" && tlCategory !== "OTHER") {
    return TL_CATEGORY_MAP[tlCategory]
  }
  const text = [merchantName, description].filter(Boolean).join(" ")
  for (const [re, cat] of MERCHANT_KEYWORD_MAP) {
    if (re.test(text)) return cat
  }
  return "Other"
}

interface TLTransaction {
  transaction_id: string
  timestamp: string
  description: string
  amount: number       // positive = credit, negative = debit; already in currency units
  currency: string
  transaction_type: string
  transaction_category: string
  merchant_name?: string | null
  normalised_provider_transaction_id?: string | null
}

interface TokenRow {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  accountId: string | null
}

export async function ensureTLTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "TruelayerToken" (
      "userId"        TEXT NOT NULL PRIMARY KEY,
      "accessToken"   TEXT NOT NULL,
      "refreshToken"  TEXT,
      "expiresAt"     TIMESTAMPTZ,
      "accountId"     TEXT,
      "accountName"   TEXT,
      "currency"      TEXT,
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "TruelayerToken_userId_key" ON "TruelayerToken"("userId")`
}

async function getFreshToken(userId: string, row: TokenRow): Promise<string> {
  if (!row.refreshToken) return row.accessToken
  if (row.expiresAt && row.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return row.accessToken
  }

  const res = await fetch(`${TL_AUTH}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.TRUELAYER_CLIENT_ID!,
      client_secret: process.env.TRUELAYER_CLIENT_SECRET!,
      refresh_token: row.refreshToken,
    }).toString(),
  })

  if (!res.ok) {
    console.error("[truelayer] token refresh failed:", res.status)
    return row.accessToken
  }

  const { access_token, refresh_token, expires_in } = await res.json()
  const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null

  await prisma.$executeRaw`
    UPDATE "TruelayerToken"
    SET "accessToken"  = ${access_token},
        "refreshToken" = ${refresh_token ?? row.refreshToken},
        "expiresAt"    = ${expiresAt},
        "updatedAt"    = NOW()
    WHERE "userId" = ${userId}
  `
  return access_token
}

export type SyncResult =
  | { ok: true; synced: number; deleted: number }
  | { ok: false; error: string; status: number }

export async function syncTruelayerForUser(userId: string): Promise<SyncResult> {
  const rows = await prisma.$queryRaw<TokenRow[]>`
    SELECT "accessToken","refreshToken","expiresAt","accountId"
    FROM "TruelayerToken" WHERE "userId" = ${userId}
  `.catch(() => [] as TokenRow[])

  if (!rows[0]) return { ok: false, error: "TrueLayer not connected", status: 400 }

  const accessToken = await getFreshToken(userId, rows[0])
  const { accountId } = rows[0]

  if (!accountId) return { ok: false, error: "No account selected — pick one in Settings", status: 400 }

  const since = new Date()
  since.setDate(since.getDate() - 60)
  const from = since.toISOString()
  const to = new Date().toISOString()

  const res = await fetch(
    `${TL_API}/accounts/${accountId}/transactions?from=${from}&to=${to}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) {
    const body = await res.text()
    console.error("[truelayer] transactions error:", res.status, body)
    if (res.status === 401) return { ok: false, error: "TrueLayer token expired — reconnect in Settings", status: 401 }
    return { ok: false, error: `TrueLayer API error (${res.status})`, status: 502 }
  }

  const { results }: { results: TLTransaction[] } = await res.json()
  let synced = 0
  let deleted = 0

  for (const t of results) {
    const amountCents = Math.round(t.amount * 100)
    const dateObj = new Date(t.timestamp)
    const mappedCategory = t.amount > 0
      ? "Income"
      : mapCategory(t.transaction_category, t.merchant_name ?? null, t.description)

    const actualId = `tl_${t.transaction_id}`

    await prisma.transaction.upsert({
      where: { actualId },
      create: {
        userId,
        actualId,
        date: dateObj,
        amount: amountCents,
        payee: t.merchant_name ?? t.description ?? null,
        category: mappedCategory,
        categoryGroup: t.transaction_category ?? null,
        notes: t.description ?? null,
        cleared: true,
        isTransfer: t.transaction_category === "TRANSFER",
      },
      update: {
        date: dateObj,
        amount: amountCents,
        payee: t.merchant_name ?? t.description ?? null,
        category: mappedCategory,
        notes: t.description ?? null,
        syncedAt: new Date(),
      },
    })
    synced++
  }

  return { ok: true, synced, deleted }
}
