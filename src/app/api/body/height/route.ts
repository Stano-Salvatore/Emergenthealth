import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

async function ensurePrefsTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "UserPreference" (
      "userId" TEXT NOT NULL,
      "key"    TEXT NOT NULL,
      "value"  TEXT NOT NULL,
      PRIMARY KEY ("userId", "key"),
      CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
    )
  `
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { heightCm } = await req.json()
  if (typeof heightCm !== "number" || heightCm < 50 || heightCm > 300) {
    return NextResponse.json({ error: "heightCm must be a number between 50 and 300" }, { status: 400 })
  }

  await ensurePrefsTable()
  const value = String(heightCm)
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, 'body_height_cm', ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `

  return NextResponse.json({ ok: true, heightCm })
}
