import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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

  try {
    await ensureTable()
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM "UserPreference" WHERE "userId" = ${userId} AND key = 'onboarding_completed' LIMIT 1
    `
    return NextResponse.json({ completed: rows.length > 0 && rows[0].value === "true" })
  } catch {
    return NextResponse.json({ completed: false })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json()
  if (!body?.completed) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  try {
    await ensureTable()
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'onboarding_completed', 'true')
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = 'true'
    `
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}
