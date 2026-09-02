import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export interface DigestSections {
  sleep: boolean
  steps: boolean
  hrv: boolean
  habits: boolean
  mood: boolean
  focus: boolean
  weight: boolean
  strava: boolean
  github: boolean
  spending: boolean
  lastfm: boolean
}

export interface DigestThresholds {
  minDays: number
}

export interface DigestPrefs {
  sections: DigestSections
  thresholds: DigestThresholds
}

export const defaultPrefs: DigestPrefs = {
  sections: {
    sleep: true,
    steps: true,
    hrv: true,
    habits: true,
    mood: true,
    focus: true,
    weight: true,
    strava: true,
    github: true,
    spending: true,
    lastfm: true,
  },
  thresholds: { minDays: 3 },
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'digest_prefs' LIMIT 1
  `.catch(() => [] as { value: string }[])
  const prefs: DigestPrefs = rows[0] ? { ...defaultPrefs, ...JSON.parse(rows[0].value) } : defaultPrefs
  return NextResponse.json(prefs)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const body = await req.json().catch(() => ({}))
  const value = JSON.stringify(body)
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, 'digest_prefs', ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `
  return NextResponse.json({ ok: true })
}
