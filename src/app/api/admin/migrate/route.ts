import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const migrations: { label: string; sql: string }[] = [
  {
    label: "OuraToken table",
    sql: `CREATE TABLE IF NOT EXISTS "OuraToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL UNIQUE,
      "accessToken" TEXT NOT NULL,
      "refreshToken" TEXT,
      "expiresAt" TIMESTAMP(3),
      "scope" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OuraToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )`,
  },
  {
    label: "OuraToken index",
    sql: `CREATE INDEX IF NOT EXISTS "OuraToken_userId_idx" ON "OuraToken"("userId")`,
  },
  {
    label: "McpApiKey table",
    sql: `CREATE TABLE IF NOT EXISTS "McpApiKey" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "token" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL DEFAULT 'Default',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "McpApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )`,
  },
  // Extended Oura metrics columns on HealthLog
  { label: "HealthLog.readinessScore", sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "readinessScore" INTEGER` },
  { label: "HealthLog.hrv",            sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "hrv" DOUBLE PRECISION` },
  { label: "HealthLog.spo2",           sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "spo2" DOUBLE PRECISION` },
  { label: "HealthLog.skinTemp",       sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "skinTemp" DOUBLE PRECISION` },
  { label: "HealthLog.sleepEfficiency",sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "sleepEfficiency" INTEGER` },
  { label: "HealthLog.sleepLatency",   sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "sleepLatency" INTEGER` },
  { label: "HealthLog.stressHigh",     sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "stressHigh" INTEGER` },
  { label: "HealthLog.totalCalories",  sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "totalCalories" INTEGER` },
  { label: "HealthLog.distanceKm",     sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "distanceKm" DOUBLE PRECISION` },
]

async function runMigrations() {
  const results: string[] = []
  for (const m of migrations) {
    try {
      await prisma.$executeRawUnsafe(m.sql)
      results.push(`✓ ${m.label}`)
    } catch (e) {
      results.push(`✗ ${m.label}: ${String(e)}`)
    }
  }
  return results
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const results = await runMigrations()
  return NextResponse.json({ success: true, results })
}

export async function GET() {
  return POST()
}
