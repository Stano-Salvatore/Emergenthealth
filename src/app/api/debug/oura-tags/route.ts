import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function fetchOura(accessToken: string, endpoint: string, params: Record<string, string>) {
  const url = new URL(`https://api.ouraring.com/v2/usercollection${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  return res.json()
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const dbRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "OuraTag" WHERE "userId" = ${userId} ORDER BY "timestamp" DESC LIMIT 5
  `

  let enhanced: unknown = null
  let legacy: unknown = null
  try {
    const stored = await prisma.ouraToken.findUnique({ where: { userId } })
    if (stored?.accessToken) {
      const p = { start_date: "2026-05-22", end_date: "2026-05-24" }
      ;[enhanced, legacy] = await Promise.all([
        fetchOura(stored.accessToken, "/enhanced_tag", p),
        fetchOura(stored.accessToken, "/tag", p),
      ])
    }
  } catch (e) {
    enhanced = { error: String(e) }
  }

  return NextResponse.json({ dbRows, enhanced, legacy })
}
