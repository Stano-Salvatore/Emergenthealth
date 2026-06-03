import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { randomBytes } from "crypto"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "UserPreference" (
      "userId" TEXT NOT NULL,
      "key"    TEXT NOT NULL,
      "value"  TEXT NOT NULL,
      PRIMARY KEY ("userId", "key"),
      CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
    )
  `
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await ensureTable()

  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = 'widget_api_key'
    LIMIT 1
  `.catch(() => [] as { value: string }[])

  if (!rows[0]) return NextResponse.json({ key: null })
  return NextResponse.json({ key: rows[0].value })
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await ensureTable()

  const newKey = "wgt_" + randomBytes(24).toString("hex")

  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, 'widget_api_key', ${newKey})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${newKey}
  `

  return NextResponse.json({ key: newKey })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await ensureTable()

  await prisma.$executeRaw`
    DELETE FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = 'widget_api_key'
  `

  return NextResponse.json({ ok: true })
}
