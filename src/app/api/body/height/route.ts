import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { heightCm } = await req.json()
  if (typeof heightCm !== "number" || heightCm < 50 || heightCm > 300) {
    return NextResponse.json({ error: "heightCm must be a number between 50 and 300" }, { status: 400 })
  }

  const value = String(heightCm)
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, 'body_height_cm', ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `

  return NextResponse.json({ ok: true, heightCm })
}
