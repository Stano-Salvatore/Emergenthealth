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
  { label: "HealthLog.totalCalories",        sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "totalCalories" INTEGER` },
  { label: "HealthLog.distanceKm",           sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "distanceKm" DOUBLE PRECISION` },
  // Oura v2 additional metrics
  { label: "HealthLog.breathingRate",        sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "breathingRate" DOUBLE PRECISION` },
  { label: "HealthLog.awakeTime",            sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "awakeTime" INTEGER` },
  { label: "HealthLog.timeInBed",            sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "timeInBed" INTEGER` },
  { label: "HealthLog.restlessPeriods",      sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "restlessPeriods" INTEGER` },
  { label: "HealthLog.activityScore",        sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "activityScore" INTEGER` },
  { label: "HealthLog.recoveryHigh",         sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "recoveryHigh" INTEGER` },
  { label: "HealthLog.sedentaryTime",        sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "sedentaryTime" INTEGER` },
  { label: "HealthLog.breathingDisturbance", sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "breathingDisturbance" DOUBLE PRECISION` },
  // Tags on Reminder
  { label: "Reminder.tags", sql: `ALTER TABLE "Reminder" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT ARRAY[]::text[]` },
  // MoodLog table
  {
    label: "MoodLog table",
    sql: `CREATE TABLE IF NOT EXISTS "MoodLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "date" DATE NOT NULL,
      "mood" INTEGER NOT NULL,
      "note" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "MoodLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
      CONSTRAINT "MoodLog_userId_date_key" UNIQUE ("userId", "date")
    )`,
  },
  { label: "MoodLog index", sql: `CREATE INDEX IF NOT EXISTS "MoodLog_userId_date_idx" ON "MoodLog"("userId", "date")` },
  // Tag table
  {
    label: "Tag table",
    sql: `CREATE TABLE IF NOT EXISTS "Tag" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "color" TEXT NOT NULL DEFAULT '#6366f1',
      CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
      CONSTRAINT "Tag_userId_name_key" UNIQUE ("userId", "name")
    )`,
  },
  { label: "Tag index", sql: `CREATE INDEX IF NOT EXISTS "Tag_userId_idx" ON "Tag"("userId")` },
  // CheckIn table
  {
    label: "CheckIn table",
    sql: `CREATE TABLE IF NOT EXISTS "CheckIn" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "place" TEXT NOT NULL,
      "emoji" TEXT NOT NULL DEFAULT '📍',
      "note" TEXT,
      "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )`,
  },
  { label: "CheckIn index", sql: `CREATE INDEX IF NOT EXISTS "CheckIn_userId_checkedAt_idx" ON "CheckIn"("userId", "checkedAt")` },
  // DailyNote table
  {
    label: "DailyNote table",
    sql: `CREATE TABLE IF NOT EXISTS "DailyNote" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "date" DATE NOT NULL,
      "content" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "DailyNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
      CONSTRAINT "DailyNote_userId_date_key" UNIQUE ("userId", "date")
    )`,
  },
  { label: "DailyNote index", sql: `CREATE INDEX IF NOT EXISTS "DailyNote_userId_date_idx" ON "DailyNote"("userId", "date")` },
  // IntakeLog table
  {
    label: "IntakeLog table",
    sql: `CREATE TABLE IF NOT EXISTS "IntakeLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "amountMl" INTEGER NOT NULL,
      "note" TEXT,
      "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "IntakeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )`,
  },
  { label: "IntakeLog index", sql: `CREATE INDEX IF NOT EXISTS "IntakeLog_userId_loggedAt_idx" ON "IntakeLog"("userId", "loggedAt")` },
  // HealthLog sleep timestamps
  { label: "HealthLog.sleepStart", sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "sleepStart" TIMESTAMP(3)` },
  { label: "HealthLog.sleepEnd",   sql: `ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "sleepEnd" TIMESTAMP(3)` },
  // FocusSession table
  {
    label: "FocusSession table",
    sql: `CREATE TABLE IF NOT EXISTS "FocusSession" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "durationMin" INTEGER NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'focus',
      "label" TEXT,
      "startedAt" TIMESTAMP(3) NOT NULL,
      "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FocusSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )`,
  },
  { label: "FocusSession index", sql: `CREATE INDEX IF NOT EXISTS "FocusSession_userId_endedAt_idx" ON "FocusSession"("userId", "endedAt")` },
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
