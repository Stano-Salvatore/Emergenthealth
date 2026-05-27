import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  // Delete raw-SQL tables first (no Prisma schema)
  const rawTables = [
    "UserFeedback", "UserPreference", "WeatherLog", "MorningCheckIn",
    "StravaToken", "GitHubProfile", "RescuetimeKey", "RescuetimeLog",
    "LastfmKey", "LastfmLog", "CheckIn"
  ]
  for (const table of rawTables) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE "userId" = $1`, userId
    ).catch(() => {})
  }

  // Delete via Prisma (schema tables cascade)
  await prisma.user.delete({ where: { id: userId } }).catch(() => {})

  return NextResponse.json({ ok: true })
}
