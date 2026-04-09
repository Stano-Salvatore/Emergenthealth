import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const CATEGORIES = [
  "Food & Drink", "Transport", "Shopping", "Entertainment",
  "Health", "Bills & Utilities", "Housing", "Income", "Other",
]

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { date, payee, amountEuros, category, notes } = await req.json()
  if (!date || amountEuros == null) {
    return NextResponse.json({ error: "date and amountEuros are required" }, { status: 400 })
  }

  const dateObj = new Date(date + "T00:00:00.000Z")
  // Store in milliunits (multiply by 100), negative = expense, positive = income
  const amount = Math.round(Number(amountEuros) * 100)

  const transaction = await prisma.transaction.create({
    data: {
      userId: session.user.id,
      date: dateObj,
      amount,
      payee: payee || null,
      category: category || null,
      notes: notes || null,
      cleared: true,
      isTransfer: false,
    },
  })

  return NextResponse.json(transaction)
}
