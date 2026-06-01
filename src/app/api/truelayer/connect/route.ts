import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ensureTLTable } from "@/lib/truelayer-sync"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ connected: false }, { status: 401 })
  await ensureTLTable()
  const rows = await prisma.$queryRaw<{ accountId: string | null; accountName: string | null; currency: string | null }[]>`
    SELECT "accountId","accountName","currency" FROM "TruelayerToken" WHERE "userId" = ${session.user.id}
  `.catch(() => [])
  const hasConfig = !!(process.env.TRUELAYER_CLIENT_ID && process.env.TRUELAYER_CLIENT_SECRET)
  if (!rows[0]) return NextResponse.json({ connected: false, hasConfig })
  return NextResponse.json({
    connected: true,
    hasConfig,
    accountId: rows[0].accountId,
    accountName: rows[0].accountName,
    currency: rows[0].currency,
  })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { accountId, accountName, currency } = await req.json()
  await prisma.$executeRaw`
    UPDATE "TruelayerToken"
    SET "accountId" = ${accountId}, "accountName" = ${accountName}, "currency" = ${currency ?? null}, "updatedAt" = NOW()
    WHERE "userId" = ${session.user.id}
  `
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await ensureTLTable()
  await prisma.$executeRaw`DELETE FROM "TruelayerToken" WHERE "userId" = ${session.user.id}`
  return NextResponse.json({ ok: true })
}
