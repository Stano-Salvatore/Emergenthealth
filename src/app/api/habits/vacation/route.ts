import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export interface VacationPeriod {
  active: boolean
  from: string   // YYYY-MM-DD
  until: string  // YYYY-MM-DD
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'vacation_mode' LIMIT 1
  `
  if (!rows.length) return NextResponse.json({ active: false, from: null, until: null })
  try {
    return NextResponse.json(JSON.parse(rows[0].value))
  } catch {
    return NextResponse.json({ active: false, from: null, until: null })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body: Partial<VacationPeriod> = await req.json()
  const value = JSON.stringify({
    active: body.active ?? false,
    from:   body.from  ?? new Date().toISOString().split("T")[0],
    until:  body.until ?? new Date().toISOString().split("T")[0],
  })

  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, 'vacation_mode', ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `
  return NextResponse.json({ ok: true })
}
