import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  type SavedPlaceRow = { id: string; name: string; emoji: string }
  const places = await prisma.$queryRaw<SavedPlaceRow[]>`
    SELECT id, name, emoji FROM "SavedPlace" WHERE "userId" = ${session.user.id} ORDER BY name
  `.catch(() => [] as SavedPlaceRow[])

  return NextResponse.json(places)
}
