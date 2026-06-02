import { prisma } from "@/lib/prisma"

export const GC_API = "https://bankaccountdata.gocardless.com/api/v2"

// Revolut EU institution (Lithuania-licensed, covers all EU countries incl. Slovakia)
export const REVOLUT_INSTITUTION_ID = "REVOLUT_REVOLT21"

interface TokenCache {
  access: string
  accessExpires: number  // ms timestamp
  refresh: string
  refreshExpires: number
}

let _tokenCache: TokenCache | null = null

export async function getAccessToken(): Promise<string> {
  const now = Date.now()

  // Use cached access token if still valid (5-min buffer)
  if (_tokenCache && _tokenCache.accessExpires - now > 5 * 60 * 1000) {
    return _tokenCache.access
  }

  // Refresh if we have a valid refresh token
  if (_tokenCache && _tokenCache.refreshExpires - now > 5 * 60 * 1000) {
    const res = await fetch(`${GC_API}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: _tokenCache.refresh }),
    })
    if (res.ok) {
      const { access, access_expires } = await res.json()
      _tokenCache.access = access
      _tokenCache.accessExpires = now + access_expires * 1000
      return access
    }
  }

  // Get a new token pair
  const res = await fetch(`${GC_API}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret_id: process.env.GOCARDLESS_SECRET_ID,
      secret_key: process.env.GOCARDLESS_SECRET_KEY,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GoCardless token error (${res.status}): ${body}`)
  }

  const { access, access_expires, refresh, refresh_expires } = await res.json()
  _tokenCache = {
    access,
    accessExpires: now + access_expires * 1000,
    refresh,
    refreshExpires: now + refresh_expires * 1000,
  }
  return access
}

export function gcHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

const GC_CATEGORY_MAP: Record<string, string> = {
  // GoCardless uses its own transaction codes but description-based mapping
}

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

function mapCategory(amount: number, description: string | null, creditorName: string | null): string {
  if (amount > 0) return "Income"
  const text = [creditorName, description].filter(Boolean).join(" ")
  for (const [re, cat] of MERCHANT_KEYWORD_MAP) {
    if (re.test(text)) return cat
  }
  return "Other"
}

interface GCTransaction {
  transactionId?: string
  internalTransactionId?: string
  bookingDate?: string
  valueDate?: string
  transactionAmount: { amount: string; currency: string }
  creditorName?: string
  debtorName?: string
  remittanceInformationUnstructured?: string
  remittanceInformationStructured?: string
  proprietaryBankTransactionCode?: string
  bankTransactionCode?: string
}

export async function ensureGCTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "GocardlessConnection" (
      "userId"         TEXT NOT NULL PRIMARY KEY,
      "requisitionId"  TEXT,
      "accountId"      TEXT,
      "accountName"    TEXT,
      "currency"       TEXT,
      "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "GocardlessConnection_userId_key" ON "GocardlessConnection"("userId")`
}

export type SyncResult =
  | { ok: true; synced: number; deleted: number }
  | { ok: false; error: string; status: number }

export async function syncGocardlessForUser(userId: string): Promise<SyncResult> {
  const rows = await prisma.$queryRaw<{
    accountId: string | null
  }[]>`
    SELECT "accountId" FROM "GocardlessConnection" WHERE "userId" = ${userId}
  `.catch(() => [])

  if (!rows[0]) return { ok: false, error: "GoCardless not connected", status: 400 }
  const { accountId } = rows[0]
  if (!accountId) return { ok: false, error: "No account selected — pick one in Settings", status: 400 }

  let token: string
  try {
    token = await getAccessToken()
  } catch (e: unknown) {
    console.error("[gocardless] token error:", e)
    return { ok: false, error: "GoCardless auth failed — check API credentials", status: 401 }
  }

  const since = new Date()
  since.setDate(since.getDate() - 60)
  const dateFrom = since.toISOString().slice(0, 10)

  const res = await fetch(
    `${GC_API}/accounts/${accountId}/transactions/?date_from=${dateFrom}`,
    { headers: gcHeaders(token) }
  )

  if (!res.ok) {
    const body = await res.text()
    console.error("[gocardless] transactions error:", res.status, body)
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "GoCardless token expired — reconnect in Settings", status: 401 }
    }
    return { ok: false, error: `GoCardless API error (${res.status})`, status: 502 }
  }

  const { transactions }: { transactions: { booked: GCTransaction[]; pending?: GCTransaction[] } } = await res.json()
  const booked = transactions?.booked ?? []
  let synced = 0

  for (const t of booked) {
    const txId = t.transactionId ?? t.internalTransactionId
    if (!txId) continue

    const amount = parseFloat(t.transactionAmount.amount)
    const amountCents = Math.round(amount * 100)
    const dateStr = t.bookingDate ?? t.valueDate
    if (!dateStr) continue
    const dateObj = new Date(dateStr)
    const description = t.remittanceInformationUnstructured ?? t.remittanceInformationStructured ?? null
    const payee = amount < 0 ? (t.creditorName ?? description ?? null) : (t.debtorName ?? description ?? null)
    const mappedCategory = mapCategory(amount, description, payee)
    const actualId = `gc_${txId}`

    await prisma.transaction.upsert({
      where: { actualId },
      create: {
        userId,
        actualId,
        date: dateObj,
        amount: amountCents,
        payee,
        category: mappedCategory,
        categoryGroup: t.proprietaryBankTransactionCode ?? t.bankTransactionCode ?? null,
        notes: description ?? null,
        cleared: true,
        isTransfer: mappedCategory === "Transfer",
      },
      update: {
        date: dateObj,
        amount: amountCents,
        payee,
        category: mappedCategory,
        notes: description ?? null,
        syncedAt: new Date(),
      },
    })
    synced++
  }

  return { ok: true, synced, deleted: 0 }
}
