import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ensureGCTable } from "@/lib/gocardless-sync"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ connected: false }, { status: 401 })
  await ensureGCTable()

  const rows = await prisma.$queryRaw<{
    requisitionId: string | null
    accountId: string | null
    accountName: string | null
    currency: string | null
  }[]>`
    SELECT "requisitionId","accountId","accountName","currency"
    FROM "GocardlessConnection" WHERE "userId" = ${session.user.id}
  `.catch(() => [])

  const hasConfig = !!(process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY)
  if (!rows[0] || !rows[0].requisitionId) return NextResponse.json({ connected: false, hasConfig })

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
    UPDATE "GocardlessConnection"
    SET "accountId" = ${accountId}, "accountName" = ${accountName}, "currency" = ${currency ?? null}, "updatedAt" = NOW()
    WHERE "userId" = ${session.user.id}
  `
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await ensureGCTable()
  await prisma.$executeRaw`
    UPDATE "GocardlessConnection"
    SET "requisitionId" = NULL, "accountId" = NULL, "accountName" = NULL, "currency" = NULL, "updatedAt" = NOW()
    WHERE "userId" = ${session.user.id}
  `
  return NextResponse.json({ ok: true })
}
