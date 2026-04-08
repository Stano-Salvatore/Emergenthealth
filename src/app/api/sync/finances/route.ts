import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const serverURL = process.env.ACTUAL_SERVER_URL
  const password = process.env.ACTUAL_SERVER_PASSWORD
  const syncId = process.env.ACTUAL_BUDGET_SYNC_ID

  if (!serverURL || !password || !syncId) {
    return NextResponse.json(
      { error: "Actual Budget not configured. Set ACTUAL_SERVER_URL, ACTUAL_SERVER_PASSWORD, and ACTUAL_BUDGET_SYNC_ID in environment variables." },
      { status: 503 }
    )
  }

  try {
    const api = await import("@actual-app/api")

    await api.init({
      dataDir: "/tmp/actual-budget",
      serverURL,
      password,
    })

    await api.downloadBudget(syncId)

    const today = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const startDate = monthStart.toISOString().split("T")[0]
    const endDate = today.toISOString().split("T")[0]

    const accounts = await api.getAccounts()
    let allTransactions: any[] = []

    for (const account of accounts) {
      const txns = await api.getTransactions(account.id, startDate, endDate)
      allTransactions = allTransactions.concat(
        txns.map((t: any) => ({ ...t, accountName: account.name }))
      )
    }

    await api.shutdown()

    // Upsert transactions
    let synced = 0
    for (const t of allTransactions) {
      const dateObj = new Date(t.date)
      dateObj.setUTCHours(0, 0, 0, 0)

      await prisma.transaction.upsert({
        where: { actualId: t.id },
        create: {
          userId: session.user.id,
          actualId: t.id,
          date: dateObj,
          amount: t.amount ?? 0,
          payee: t.payee_name ?? null,
          category: t.category_name ?? null,
          accountName: t.accountName ?? null,
          notes: t.notes ?? null,
          cleared: t.cleared ?? false,
          isTransfer: !!t.transfer_id,
        },
        update: {
          date: dateObj,
          amount: t.amount ?? 0,
          payee: t.payee_name ?? null,
          category: t.category_name ?? null,
          notes: t.notes ?? null,
          cleared: t.cleared ?? false,
          syncedAt: new Date(),
        },
      })
      synced++
    }

    return NextResponse.json({ success: true, synced })
  } catch (error: any) {
    console.error("Actual Budget sync error:", error)
    return NextResponse.json(
      { error: `Sync failed: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const monthParam = searchParams.get("month")

  let dateFilter: { gte: Date; lt: Date }
  if (monthParam) {
    const [year, month] = monthParam.split("-").map(Number)
    dateFilter = {
      gte: new Date(year, month - 1, 1),
      lt: new Date(year, month, 1),
    }
  } else {
    const now = new Date()
    dateFilter = {
      gte: new Date(now.getFullYear(), now.getMonth(), 1),
      lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    }
  }

  const transactions = await prisma.transaction.findMany({
    where: { userId: session.user.id, date: dateFilter },
    orderBy: { date: "desc" },
  })

  return NextResponse.json(transactions)
}
