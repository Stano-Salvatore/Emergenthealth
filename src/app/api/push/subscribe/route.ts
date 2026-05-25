import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "PushSubscription" (
      "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "userId"    TEXT NOT NULL,
      "endpoint"  TEXT NOT NULL UNIQUE,
      "p256dh"    TEXT NOT NULL,
      "auth"      TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { endpoint, keys } = await req.json()
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 })
  }

  await ensureTable()
  await prisma.$executeRaw`
    INSERT INTO "PushSubscription"("userId","endpoint","p256dh","auth")
    VALUES (${session.user.id}, ${endpoint}, ${keys.p256dh}, ${keys.auth})
    ON CONFLICT("endpoint") DO UPDATE SET "userId" = ${session.user.id}
  `
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { endpoint } = await req.json()
  await ensureTable()
  await prisma.$executeRaw`
    DELETE FROM "PushSubscription"
    WHERE "endpoint" = ${endpoint} AND "userId" = ${session.user.id}
  `
  return NextResponse.json({ ok: true })
}
