import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Server-side persistence for the dashboard Notes widget, so the scratchpad
// follows the user across devices. Mirrors the dashboard preferences route.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ notes: null }, { status: 401 })
  const userId = session.user.id
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'dashboard_notes' LIMIT 1
  `
  return NextResponse.json({ notes: rows[0]?.value ?? null })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const body = await req.json().catch(() => ({}))
  if (typeof body.notes !== "string") return NextResponse.json({ error: "Invalid" }, { status: 400 })
  // Guard against unbounded growth.
  const v = body.notes.slice(0, 10_000)
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'dashboard_notes',${v})
    ON CONFLICT ("userId","key") DO UPDATE SET "value"=${v}
  `
  return NextResponse.json({ ok: true })
}
