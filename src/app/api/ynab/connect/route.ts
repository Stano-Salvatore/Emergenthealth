import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { budgetId, budgetName } = await req.json()
  await prisma.ynabToken.update({
    where: { userId: session.user.id },
    data: { budgetId, budgetName, updatedAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await prisma.ynabToken.deleteMany({ where: { userId: session.user.id } })
  return NextResponse.json({ ok: true })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ connected: false }, { status: 401 })
  const token = await prisma.ynabToken.findUnique({
    where: { userId: session.user.id },
    select: { budgetId: true, budgetName: true },
  }).catch(() => null)
  if (!token) return NextResponse.json({ connected: false })
  return NextResponse.json({
    connected: true,
    budgetId: token.budgetId,
    budgetName: token.budgetName,
  })
}
