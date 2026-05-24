import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "TagAlias" (
      "userId"      TEXT NOT NULL,
      "tagTypeUuid" TEXT NOT NULL,
      "name"        TEXT NOT NULL,
      PRIMARY KEY ("userId", "tagTypeUuid")
    )
  `
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ aliases: {} }, { status: 401 })
  const userId = session.user.id
  await ensureTable()
  const rows = await prisma.$queryRaw<{ tagTypeUuid: string; name: string }[]>`
    SELECT "tagTypeUuid", "name" FROM "TagAlias" WHERE "userId" = ${userId}
  `
  const aliases = Object.fromEntries(rows.map(r => [r.tagTypeUuid, r.name]))
  return NextResponse.json({ aliases })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { tagTypeUuid, name } = await req.json()
  if (!tagTypeUuid || !name?.trim()) return NextResponse.json({ error: "tagTypeUuid and name required" }, { status: 400 })
  await ensureTable()
  await prisma.$executeRaw`
    INSERT INTO "TagAlias"("userId","tagTypeUuid","name")
    VALUES (${userId}, ${tagTypeUuid}, ${name.trim()})
    ON CONFLICT("userId","tagTypeUuid") DO UPDATE SET "name" = EXCLUDED."name"
  `
  return NextResponse.json({ ok: true })
}
