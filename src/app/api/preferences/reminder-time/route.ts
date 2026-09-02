import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'reminder_hour' LIMIT 1
  `.catch(() => [] as { value: string }[])
  const hour = rows[0] ? parseInt(rows[0].value, 10) : 7
  return NextResponse.json({ hour })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { hour } = await req.json().catch(() => ({ hour: 7 }))
  const h = Math.max(5, Math.min(23, parseInt(String(hour), 10)))
  if (isNaN(h)) return NextResponse.json({ error: "Invalid hour" }, { status: 400 })
  const value = String(h)
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, 'reminder_hour', ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `
  return NextResponse.json({ ok: true, hour: h })
}
