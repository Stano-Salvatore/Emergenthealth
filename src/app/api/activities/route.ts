import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const activities = await prisma.stravaActivity.findMany({
    where: { userId, day: { gte: since } },
    orderBy: { startDate: "desc" },
    take: 30,
  }).catch(() => [])

  return NextResponse.json({ activities })
}
