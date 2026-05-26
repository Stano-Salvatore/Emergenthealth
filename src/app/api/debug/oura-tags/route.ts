import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Diagnostic endpoint — fetches both /enhanced_tag and /tag endpoints raw,
// shows all fields and values so we can find where the tag name lives.
// GET /api/debug/oura-tags

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const stored = await prisma.ouraToken.findUnique({ where: { userId } })
  if (!stored?.accessToken) return NextResponse.json({ error: "Oura not connected" }, { status: 503 })

  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  async function fetchOura(endpoint: string) {
    try {
      const url = new URL(`https://api.ouraring.com/v2/usercollection/${endpoint}`)
      url.searchParams.set("start_date", monthAgo)
      url.searchParams.set("end_date", today)
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${stored!.accessToken}` },
      })
      const data = await res.json()
      return { status: res.status, items: (data.data ?? data ?? []).slice(0, 5), fullKeys: data }
    } catch (e) {
      return { status: 0, items: [], error: String(e), fullKeys: {} }
    }
  }

  const [enhancedTag, tagV2] = await Promise.all([
    fetchOura("enhanced_tag"),
    fetchOura("tag"),
  ])

  // Stored rows with all columns
  const storedRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "OuraTag" WHERE "userId" = ${userId} ORDER BY "timestamp" DESC LIMIT 5
  `.catch(() => [])

  const aliases = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "TagAlias" WHERE "userId" = ${userId}
  `.catch(() => [])

  return NextResponse.json({
    enhanced_tag: {
      httpStatus: enhancedTag.status,
      topLevelKeys: Object.keys(enhancedTag.fullKeys),
      fields: enhancedTag.items.length > 0 ? Object.keys(enhancedTag.items[0] as object) : [],
      items: enhancedTag.items,
    },
    tag_endpoint: {
      httpStatus: tagV2.status,
      fields: tagV2.items.length > 0 ? Object.keys(tagV2.items[0] as object) : [],
      items: tagV2.items,
    },
    stored_oura_tags: storedRows,
    tag_aliases: aliases,
  })
}
