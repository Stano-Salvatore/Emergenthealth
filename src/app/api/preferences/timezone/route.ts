import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM "UserPreference" WHERE "userId" = ${session.user.id} AND key = 'timezone' LIMIT 1
  `.catch(() => [] as { value: string }[])

  return NextResponse.json({ timezone: rows[0]?.value ?? null })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { timezone } = await req.json()
  if (!timezone || typeof timezone !== "string") return NextResponse.json({ error: "Invalid" }, { status: 400 })

  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", key, value)
    VALUES (${session.user.id}, 'timezone', ${timezone})
    ON CONFLICT ("userId", key) DO UPDATE SET value = ${timezone}
  `

  return NextResponse.json({ ok: true })
}
