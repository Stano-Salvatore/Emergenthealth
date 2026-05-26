import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Temporary diagnostic endpoint — returns the raw Oura enhanced_tag response
// plus what we have stored in OuraTag, so we can see exactly what fields Oura sends.
// Hit GET /api/debug/oura-tags to inspect.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const stored = await prisma.ouraToken.findUnique({ where: { userId } })
  if (!stored?.accessToken) return NextResponse.json({ error: "Oura not connected" }, { status: 503 })

  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  // Fetch raw from Oura — no field mapping, return everything as-is
  let rawOura: unknown[] = []
  let ouraError: string | null = null
  try {
    const url = new URL("https://api.ouraring.com/v2/usercollection/enhanced_tag")
    url.searchParams.set("start_date", monthAgo)
    url.searchParams.set("end_date", today)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${stored.accessToken}` },
    })
    const data = await res.json()
    rawOura = (data.data ?? []).slice(0, 5) // first 5 entries only
  } catch (e) {
    ouraError = String(e)
  }

  // What we have stored
  const storedRows = await prisma.$queryRaw<{ id: string; tagName: string | null; text: string | null; tags: string[] }[]>`
    SELECT "id","tagName","text","tags"
    FROM "OuraTag"
    WHERE "userId" = ${userId}
    ORDER BY "timestamp" DESC
    LIMIT 5
  `.catch(() => [])

  return NextResponse.json({
    note: "First 5 raw entries from Oura API + first 5 stored rows. Check field names here.",
    rawOuraFields: rawOura.length > 0 ? Object.keys(rawOura[0] as object) : [],
    rawOura,
    ouraError,
    stored: storedRows,
  })
}
