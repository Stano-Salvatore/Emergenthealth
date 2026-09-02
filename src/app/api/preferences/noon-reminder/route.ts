import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'noon_reminder_enabled' LIMIT 1
  `.catch(() => [] as { value: string }[])
  const enabled = rows[0] ? rows[0].value !== "false" : true
  return NextResponse.json({ enabled })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { enabled } = await req.json().catch(() => ({ enabled: true }))
  const value = String(!!enabled)
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, 'noon_reminder_enabled', ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `
  return NextResponse.json({ ok: true, enabled: !!enabled })
}
