import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSubscriptionEmails } from "@/lib/gmail"
import { detectRecurringCharges } from "@/lib/subscriptions"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const [emailSubs, transactions] = await Promise.all([
    getSubscriptionEmails(session.user.id),
    prisma.transaction.findMany({
      where: { userId: session.user.id, date: { gte: ninetyDaysAgo }, isTransfer: false },
      select: { amount: true, payee: true, date: true, category: true },
    }),
  ])

  // detectRecurringCharges expects a `description` field; map payee → description
  const recurring = detectRecurringCharges(
    transactions.map(t => ({ ...t, description: t.payee ?? "" }))
  )

  return NextResponse.json({ emailSubs, recurring })
}
