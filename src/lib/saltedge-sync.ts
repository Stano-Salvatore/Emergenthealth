import { prisma } from "@/lib/prisma"

export const SE_API = "https://www.saltedge.com/api/v6"

export function seHeaders() {
  return {
    "App-id": process.env.SALTEDGE_APP_ID!,
    "Secret": process.env.SALTEDGE_SECRET!,
    "Content-Type": "application/json",
  }
}

const SE_CATEGORY_MAP: Record<string, string> = {
  income: "Income",
  transfers: "Transfer",
  atm: "Cash",
  cash: "Cash",
  food_and_dining: "Food & Drink",
  restaurants: "Food & Drink",
  groceries: "Food & Drink",
  public_transportation: "Transport",
  gasoline: "Transport",
  travel: "Transport",
  entertainment: "Entertainment",
  shopping: "Shopping",
  electronics: "Shopping",
  home: "Housing",
  utilities: "Bills & Utilities",
  insurance: "Bills & Utilities",
  bank_charges: "Bills & Utilities",
  taxes: "Bills & Utilities",
  health: "Health",
  sports_and_fitness: "Health",
  education: "Education",
  gifts: "Shopping",
  pets: "Other",
  business: "Other",
  investment: "Savings",
  loans: "Debt",
  government: "Other",
  advertising: "Other",
  general: "Other",
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

function mapCategory(seCategory: string | null, description: string | null): string {
  if (seCategory) {
    const mapped = SE_CATEGORY_MAP[seCategory.toLowerCase()]
    if (mapped) return mapped
  }
  const text = description ?? ""
  for (const [re, cat] of MERCHANT_KEYWORD_MAP) {
    if (re.test(text)) return cat
  }
  return "Other"
}

interface SETransaction {
  id: string
  made_on: string               // "2024-01-15"
  amount: number                // negative = debit
  currency_code: string
  description: string
  category: string | null
  mode: string
  status: string
  extra?: {
    payee?: string | null
    merchant_id?: string | null
    original_amount?: number | null
    original_currency_code?: string | null
  }
}

export async function ensureSETable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "SaltedgeConnection" (
      "userId"       TEXT NOT NULL PRIMARY KEY,
      "customerId"   TEXT NOT NULL,
      "connectionId" TEXT,
      "accountId"    TEXT,
      "accountName"  TEXT,
      "currency"     TEXT,
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "SaltedgeConnection_userId_key" ON "SaltedgeConnection"("userId")`
}

export async function getOrCreateCustomer(userId: string): Promise<string> {
  // Check if we already have a customerId stored
  const rows = await prisma.$queryRaw<{ customerId: string }[]>`
    SELECT "customerId" FROM "SaltedgeConnection" WHERE "userId" = ${userId}
  `.catch(() => [])
  if (rows[0]?.customerId) return rows[0].customerId

  // Create a new customer in Salt Edge
  const res = await fetch(`${SE_API}/customers`, {
    method: "POST",
    headers: seHeaders(),
    body: JSON.stringify({ data: { identifier: userId } }),
  })

  if (res.ok) {
    const { data } = await res.json()
    return data.id as string
  }

  // Customer may already exist (409) — fetch by identifier
  if (res.status === 409) {
    const listRes = await fetch(`${SE_API}/customers?identifier=${encodeURIComponent(userId)}`, {
      headers: seHeaders(),
    })
    if (listRes.ok) {
      const { data } = await listRes.json()
      const customer = Array.isArray(data) ? data[0] : data
      if (customer?.id) return customer.id as string
    }
  }

  throw new Error(`Salt Edge customer creation failed: ${res.status}`)
}

export type SyncResult =
  | { ok: true; synced: number; deleted: number }
  | { ok: false; error: string; status: number }

export async function syncSaltedgeForUser(userId: string): Promise<SyncResult> {
  const rows = await prisma.$queryRaw<{
    connectionId: string | null
    accountId: string | null
  }[]>`
    SELECT "connectionId","accountId" FROM "SaltedgeConnection" WHERE "userId" = ${userId}
  `.catch(() => [])

  if (!rows[0]) return { ok: false, error: "Salt Edge not connected", status: 400 }
  const { connectionId, accountId } = rows[0]
  if (!connectionId) return { ok: false, error: "No bank connection found — reconnect in Settings", status: 400 }
  if (!accountId) return { ok: false, error: "No account selected — pick one in Settings", status: 400 }

  const since = new Date()
  since.setDate(since.getDate() - 60)
  const fromDate = since.toISOString().slice(0, 10)

  const res = await fetch(
    `${SE_API}/transactions?connection_id=${connectionId}&account_id=${accountId}&from_date=${fromDate}`,
    { headers: seHeaders() }
  )

  if (!res.ok) {
    const body = await res.text()
    console.error("[saltedge] transactions error:", res.status, body)
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Salt Edge token expired — reconnect in Settings", status: 401 }
    }
    return { ok: false, error: `Salt Edge API error (${res.status})`, status: 502 }
  }

  const { data }: { data: SETransaction[] } = await res.json()
  let synced = 0

  for (const t of data) {
    if (t.status === "pending") continue
    const amountCents = Math.round(t.amount * 100)
    const dateObj = new Date(t.made_on)
    const mappedCategory = t.amount > 0
      ? "Income"
      : mapCategory(t.category, t.description)

    const actualId = `se_${t.id}`
    const payee = t.extra?.payee ?? t.description ?? null

    await prisma.transaction.upsert({
      where: { actualId },
      create: {
        userId,
        actualId,
        date: dateObj,
        amount: amountCents,
        payee,
        category: mappedCategory,
        categoryGroup: t.category ?? null,
        notes: t.description ?? null,
        cleared: true,
        isTransfer: t.category === "transfers",
      },
      update: {
        date: dateObj,
        amount: amountCents,
        payee,
        category: mappedCategory,
        notes: t.description ?? null,
        syncedAt: new Date(),
      },
    })
    synced++
  }

  return { ok: true, synced, deleted: 0 }
}
