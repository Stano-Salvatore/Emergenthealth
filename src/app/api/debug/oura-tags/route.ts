import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Temporary debug endpoint — shows raw OuraTag rows from DB
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "OuraTag"
    WHERE "userId" = ${session.user.id}
    ORDER BY "timestamp" DESC
    LIMIT 10
  `
  return NextResponse.json({ rows })
}
