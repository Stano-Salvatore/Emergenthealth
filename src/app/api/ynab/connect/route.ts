import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "YnabToken" (
      "userId"       TEXT NOT NULL PRIMARY KEY,
      "accessToken"  TEXT,
      "refreshToken" TEXT,
      "expiresAt"    TIMESTAMPTZ,
      "budgetId"     TEXT,
      "budgetName"   TEXT,
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Reconcile legacy schemas
  await prisma.$executeRaw`ALTER TABLE "YnabToken" ADD COLUMN IF NOT EXISTS "accessToken"  TEXT`
  await prisma.$executeRaw`ALTER TABLE "YnabToken" ADD COLUMN IF NOT EXISTS "refreshToken" TEXT`
  await prisma.$executeRaw`ALTER TABLE "YnabToken" ADD COLUMN IF NOT EXISTS "expiresAt"    TIMESTAMPTZ`
  await prisma.$executeRaw`ALTER TABLE "YnabToken" ADD COLUMN IF NOT EXISTS "budgetId"     TEXT`
  await prisma.$executeRaw`ALTER TABLE "YnabToken" ADD COLUMN IF NOT EXISTS "budgetName"   TEXT`
  await prisma.$executeRaw`ALTER TABLE "YnabToken" ADD COLUMN IF NOT EXISTS "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'YnabToken' AND column_name = 'token'
      ) THEN
        EXECUTE 'ALTER TABLE "YnabToken" ALTER COLUMN "token" DROP NOT NULL';
      END IF;
    END $$;
  `)
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "YnabToken_userId_key" ON "YnabToken"("userId")`
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { budgetId, budgetName } = await req.json()
  await prisma.$executeRaw`
    UPDATE "YnabToken"
    SET "budgetId" = ${budgetId}, "budgetName" = ${budgetName}, "updatedAt" = NOW()
    WHERE "userId" = ${session.user.id}
  `
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await ensureTable()
  await prisma.$executeRaw`DELETE FROM "YnabToken" WHERE "userId" = ${session.user.id}`
  return NextResponse.json({ ok: true })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ connected: false }, { status: 401 })
  await ensureTable()
  const rows = await prisma.$queryRaw<{ budgetId: string; budgetName: string }[]>`
    SELECT "budgetId","budgetName" FROM "YnabToken" WHERE "userId" = ${session.user.id}
  `
  if (!rows[0]) return NextResponse.json({ connected: false })
  return NextResponse.json({
    connected: true,
    budgetId: rows[0].budgetId,
    budgetName: rows[0].budgetName,
  })
}
