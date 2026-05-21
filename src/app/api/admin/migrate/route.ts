import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const results: string[] = []

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "OuraToken" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL UNIQUE,
        "accessToken" TEXT NOT NULL,
        "refreshToken" TEXT,
        "expiresAt" TIMESTAMP(3),
        "scope" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "OuraToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
      )
    `)
    results.push("OuraToken table: ok")
  } catch (e) {
    results.push(`OuraToken table: ${String(e)}`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "OuraToken_userId_idx" ON "OuraToken"("userId")
    `)
    results.push("OuraToken index: ok")
  } catch (e) {
    results.push(`OuraToken index: ${String(e)}`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "McpApiKey" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "token" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL DEFAULT 'Default',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "McpApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
      )
    `)
    results.push("McpApiKey table: ok")
  } catch (e) {
    results.push(`McpApiKey table: ${String(e)}`)
  }

  return NextResponse.json({ success: true, results })
}

// Convenience GET so you can trigger it from the browser address bar
export async function GET() {
  return POST()
}
