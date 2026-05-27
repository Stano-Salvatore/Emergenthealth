import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  void req
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await prisma.$executeRaw`
      DELETE FROM "StravaToken" WHERE "userId" = ${session.user.id}
    `
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[strava/disconnect] error:", err)
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
  }
}
