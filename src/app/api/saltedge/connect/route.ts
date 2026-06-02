import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ensureSETable } from "@/lib/saltedge-sync"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ connected: false }, { status: 401 })
  await ensureSETable()

  const rows = await prisma.$queryRaw<{
    connectionId: string | null
    accountId: string | null
    accountName: string | null
    currency: string | null
  }[]>`
    SELECT "connectionId","accountId","accountName","currency"
    FROM "SaltedgeConnection" WHERE "userId" = ${session.user.id}
  `.catch(() => [])

  const hasConfig = !!(process.env.SALTEDGE_APP_ID && process.env.SALTEDGE_SECRET)
  if (!rows[0] || !rows[0].connectionId) return NextResponse.json({ connected: false, hasConfig })

  return NextResponse.json({
    connected: true,
    hasConfig,
    connectionId: rows[0].connectionId,
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
    UPDATE "SaltedgeConnection"
    SET "accountId" = ${accountId}, "accountName" = ${accountName}, "currency" = ${currency ?? null}, "updatedAt" = NOW()
    WHERE "userId" = ${session.user.id}
  `
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await ensureSETable()
  // Nullify connection fields but keep the customerId so reconnect reuses the same customer
  await prisma.$executeRaw`
    UPDATE "SaltedgeConnection"
    SET "connectionId" = NULL, "accountId" = NULL, "accountName" = NULL, "currency" = NULL, "updatedAt" = NOW()
    WHERE "userId" = ${session.user.id}
  `
  return NextResponse.json({ ok: true })
}
