import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Ensure table exists
async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "PushSubscription" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      "userId" TEXT NOT NULL,
      "endpoint" TEXT NOT NULL,
      "p256dh" TEXT NOT NULL,
      "auth" TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE("userId", "endpoint")
    )
  `.catch(() => {})
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json()
  const { endpoint, keys } = body
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 })
  }

  await ensureTable()
  await prisma.$executeRaw`
    INSERT INTO "PushSubscription" ("userId", "endpoint", "p256dh", "auth")
    VALUES (${userId}, ${endpoint}, ${keys.p256dh}, ${keys.auth})
    ON CONFLICT ("userId", "endpoint") DO UPDATE SET "p256dh" = ${keys.p256dh}, "auth" = ${keys.auth}
  `
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  if (body.endpoint) {
    await prisma.$executeRaw`
      DELETE FROM "PushSubscription" WHERE "userId" = ${userId} AND "endpoint" = ${body.endpoint}
    `.catch(() => {})
  } else {
    await prisma.$executeRaw`
      DELETE FROM "PushSubscription" WHERE "userId" = ${userId}
    `.catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
