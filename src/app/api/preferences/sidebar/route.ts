import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ hidden: [], order: [] }, { status: 401 })
  const userId = session.user.id
  const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT "key", "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" IN ('sidebar_hidden', 'sidebar_order')
  `
  const get = (k: string) => rows.find(r => r.key === k)?.value
  return NextResponse.json({
    hidden: get("sidebar_hidden") ? JSON.parse(get("sidebar_hidden")!) : [],
    order:  get("sidebar_order")  ? JSON.parse(get("sidebar_order")!)  : [],
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const body = await req.json()

  if (Array.isArray(body.hidden)) {
    const v = JSON.stringify(body.hidden)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'sidebar_hidden',${v})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${v}
    `
  }
  if (Array.isArray(body.order)) {
    const v = JSON.stringify(body.order)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'sidebar_order',${v})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${v}
    `
  }
  return NextResponse.json({ ok: true })
}
