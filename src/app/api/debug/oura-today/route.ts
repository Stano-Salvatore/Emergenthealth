import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const stored = await prisma.ouraToken.findUnique({ where: { userId } })
  if (!stored?.accessToken) return NextResponse.json({ error: "No token" })

  const url = new URL("https://api.ouraring.com/v2/usercollection/enhanced_tag")
  url.searchParams.set("start_date", "2026-05-24")
  url.searchParams.set("end_date", "2026-05-24")

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${stored.accessToken}` },
  })
  const raw = await res.json()

  // Also show what's currently in DB for today
  const dbRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT "id","day","timestamp","tagName","text","tags"
    FROM "OuraTag"
    WHERE "userId" = ${userId} AND "day" = '2026-05-24'
    ORDER BY "timestamp" ASC
  `

  return NextResponse.json({ ouraApi: raw, dbRows })
}
