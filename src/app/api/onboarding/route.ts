import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM "UserPreference" WHERE "userId" = ${userId} AND key = 'onboarding_completed' LIMIT 1
    `
    // What is already connected, so the wizard's connect step shows the truth
    // when it comes back from Oura or Strava rather than a fresh button.
    const [oura, strava] = await Promise.all([
      prisma.ouraToken.findUnique({ where: { userId }, select: { userId: true } }).catch(() => null),
      prisma.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "StravaToken" WHERE "userId" = ${userId} LIMIT 1`.catch(() => []),
    ])
    return NextResponse.json({
      completed: rows.length > 0 && rows[0].value === "true",
      connections: { oura: !!oura, strava: strava.length > 0 },
    })
  } catch {
    return NextResponse.json({ completed: false, connections: { oura: false, strava: false } })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  // Skipping the wizard completes it too — otherwise the dashboard would send
  // them straight back. `skipped` is kept so a skip can be told from a finish.
  const body = await req.json().catch(() => null)
  if (!body?.completed) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  try {
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'onboarding_completed', 'true')
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = 'true'
    `

    if (body.skipped === true) {
      await prisma.$executeRaw`
        INSERT INTO "UserPreference" ("userId", "key", "value")
        VALUES (${userId}, 'onboarding_skipped', 'true')
        ON CONFLICT ("userId", "key") DO UPDATE SET "value" = 'true'
      `.catch(() => {})
    }

    const ref = typeof body.ref === "string" ? body.ref : null
    if (ref && /^[a-z0-9]{6,12}$/.test(ref)) {
      await prisma.$executeRaw`
        INSERT INTO "UserPreference" ("userId", "key", "value")
        VALUES (${userId}, 'referred_by', ${ref})
        ON CONFLICT ("userId", "key") DO NOTHING
      `.catch(() => {})
    }

    // The wizard's tracking categories and goal used to be collected and then
    // thrown away — the wizard only ever sent {completed}. Kept as
    // preferences so they survive the wizard.
    const categories = Array.isArray(body.categories)
      ? (body.categories as unknown[]).filter((c): c is string => typeof c === "string").slice(0, 20)
      : null
    if (categories && categories.length > 0) {
      const value = JSON.stringify(categories)
      await prisma.$executeRaw`
        INSERT INTO "UserPreference" ("userId", "key", "value")
        VALUES (${userId}, 'onboarding_categories', ${value})
        ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
      `.catch(() => {})
    }

    const goal = typeof body.goal === "string" && body.goal.trim() ? body.goal.trim().slice(0, 200) : null
    if (goal) {
      await prisma.$executeRaw`
        INSERT INTO "UserPreference" ("userId", "key", "value")
        VALUES (${userId}, 'onboarding_goal', ${goal})
        ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${goal}
      `.catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}
