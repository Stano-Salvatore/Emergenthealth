import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

function generateCode(userId: string): string {
  // Deterministic 8-char code from userId (CUIDs start with 'c', strip it)
  return userId.replace(/[^a-z0-9]/gi, "").slice(1, 9).toLowerCase()
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const code = generateCode(userId)

  // Ensure the code is stored
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", key, value)
    VALUES (${userId}, 'invite_code', ${code})
    ON CONFLICT ("userId", key) DO NOTHING
  `.catch(() => {})

  // Count how many people used this code
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::int as count FROM "UserPreference"
    WHERE key = 'referred_by' AND value = ${code}
  `.catch(() => [] as { count: bigint }[])

  const referralCount = Number(rows[0]?.count ?? 0)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://emergenthealth.app"

  return NextResponse.json({ code, inviteUrl: `${appUrl}/invite/${code}`, referralCount })
}
