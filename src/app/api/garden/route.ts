import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getWeatherCoords } from "@/lib/weather-location"
import { computeXp, getGithubStats, getLevel } from "@/lib/xp"
import { localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { computeStreak, computeMissedDays, getVacationWindow, makeIsFrozen } from "@/lib/streak"

// ─── Decoration unlocks ───────────────────────────────────────────────────────
// Decorations are earned, not toggled freely — each has a real-data condition.
// Once earned they stay unlocked forever (persisted in garden:unlocked).

interface UnlockCtx {
  level: number
  completions: number
  maxStreak: number
  journal: number
  focus: number
  intakeDays: number
  checkins: number
}

const UNLOCK_RULES: { id: string; req: string; have: (c: UnlockCtx) => number; need: number }[] = [
  { id: "ladybug",   req: "10 habit completions",   have: c => c.completions, need: 10 },
  { id: "stone",     req: "Reach level 2",           have: c => c.level,       need: 2 },
  { id: "snail",     req: "3 journal entries",       have: c => c.journal,     need: 3 },
  { id: "butterfly", req: "7-day habit streak",      have: c => c.maxStreak,   need: 7 },
  { id: "mushroom",  req: "5 focus sessions",        have: c => c.focus,       need: 5 },
  { id: "hedgehog",  req: "5 morning check-ins",     have: c => c.checkins,    need: 5 },
  { id: "frog",      req: "15 days of intake logs",  have: c => c.intakeDays,  need: 15 },
  { id: "bee",       req: "50 habit completions",    have: c => c.completions, need: 50 },
  { id: "bird",      req: "14-day habit streak",     have: c => c.maxStreak,   need: 14 },
  { id: "gnome",     req: "Reach level 5 (Flower)",  have: c => c.level,       need: 5 },
  { id: "fox",       req: "30-day habit streak",     have: c => c.maxStreak,   need: 30 },
  { id: "rainbow",   req: "Reach level 7 (Forest)",  have: c => c.level,       need: 7 },
]

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000)
  const timezone = await getUserTimezone(userId)

  // Unlock requirements are counted, not reverse-engineered from XP. Dividing
  // xp.habits by 10 to recover a completion count silently moved every
  // threshold whenever an XP rate changed, and only ever saw the last year.
  const [
    habits, prefs, checkinRows, xp, github, vacation,
    completionCount, journalCount, focusCount, intakeDayRows,
  ] = await Promise.all([
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      include: {
        completions: {
          where: { date: { gte: sixtyDaysAgo } },
          orderBy: { date: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value" FROM "UserPreference"
      WHERE "userId" = ${userId} AND "key" LIKE 'garden:%'
    `,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "MorningCheckIn" WHERE "userId" = ${userId}
    `.catch(() => [{ n: BigInt(0) }]),
    computeXp(userId),
    // Cached (6h) GitHub commit XP — the streaks page counts it, so the garden
    // must too or the two pages show different levels for the same user.
    getGithubStats(userId),
    getVacationWindow(userId),
    prisma.habitCompletion.count({ where: { userId } }).catch(() => 0),
    prisma.dailyNote.count({ where: { userId } }).catch(() => 0),
    prisma.focusSession.count({ where: { userId, type: "focus" } }).catch(() => 0),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT DATE(("loggedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}))::bigint AS n
      FROM "IntakeLog" WHERE "userId" = ${userId}
    `.catch(() => [{ n: BigInt(0) }]),
  ])

  const today = localDateStr(timezone)
  const isFrozen = makeIsFrozen(vacation)

  const habitsData = habits.map(habit => {
    const completionDates = new Set(
      habit.completions.map(c => new Date(c.date).toISOString().split("T")[0])
    )
    const completedToday = completionDates.has(today)
    // Same walk the Habits page uses — including vacation days, which this
    // used to ignore, so a frozen streak still wilted its plant.
    const streak = computeStreak(completionDates, today, isFrozen)
    const missedDays = computeMissedDays(completionDates, today, isFrozen)

    return { id: habit.id, name: habit.name, icon: habit.icon, color: habit.color, streak, completedToday, missedDays }
  })

  // Preferences
  const plantChoices: Record<string, string> = {}
  let decorations: string[] = []
  let storedUnlocked: string[] = []
  let watered: { count: number; last: string } = { count: 0, last: "" }
  let fed: { count: number; last: string } = { count: 0, last: "" }
  let layout: { placed: Record<string, { x: number; y: number }> } = { placed: {} }
  for (const p of prefs) {
    if (p.key.startsWith("garden:plant:")) plantChoices[p.key.slice(13)] = p.value
    else if (p.key === "garden:decorations") { try { decorations = JSON.parse(p.value) } catch {} }
    else if (p.key === "garden:unlocked") { try { storedUnlocked = JSON.parse(p.value) } catch {} }
    else if (p.key === "garden:watered") { try { watered = { count: 0, last: "", ...JSON.parse(p.value) } } catch {} }
    else if (p.key === "garden:fed") { try { fed = { count: 0, last: "", ...JSON.parse(p.value) } } catch {} }
    else if (p.key === "garden:layout") { try { layout = { placed: {}, ...JSON.parse(p.value) } } catch {} }
  }

  // Level + unlock evaluation
  const totalXp = xp.total + github.xp
  const level = getLevel(totalXp)
  const ctx: UnlockCtx = {
    level: level.level,
    completions: completionCount,
    maxStreak: Math.max(0, ...habitsData.map(h => h.streak)),
    journal: journalCount,
    focus: focusCount,
    intakeDays: Number(intakeDayRows[0]?.n ?? 0),
    checkins: Number(checkinRows[0]?.n ?? 0),
  }

  // Anything already placed in the garden stays unlocked (pre-overhaul users)
  const unlocked = new Set([...storedUnlocked, ...decorations])
  for (const rule of UNLOCK_RULES) {
    if (rule.have(ctx) >= rule.need) unlocked.add(rule.id)
  }
  if (unlocked.size !== storedUnlocked.length) {
    const value = JSON.stringify([...unlocked])
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'garden:unlocked', ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `.catch(() => null)
  }

  const locked = UNLOCK_RULES
    .filter(r => !unlocked.has(r.id))
    .map(r => ({ id: r.id, req: r.req, have: Math.min(r.have(ctx), r.need), need: r.need }))

  // Weather (Open-Meteo, cached 30 min)
  const wc = await getWeatherCoords(userId)
  let weather: { code: number; temp: number } | null = null
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${wc.lat}&longitude=${wc.lon}&current=temperature_2m,weathercode&forecast_days=1&timezone=${wc.tz}`,
      { signal: AbortSignal.timeout(3000), next: { revalidate: 1800 } }
    ).catch(() => null)
    if (res?.ok) {
      const d = await res.json()
      weather = { code: d.current?.weathercode ?? 0, temp: Math.round(d.current?.temperature_2m ?? 15) }
    }
  } catch {}

  return NextResponse.json({
    habits: habitsData,
    plantChoices,
    decorations,
    layout,
    weather,
    level: {
      level: level.level,
      name: level.levelName,
      emoji: level.levelEmoji,
      progress: level.progress,
      xp: totalXp,
      xpToNext: level.xpToNext,
    },
    unlocked: [...unlocked],
    locked,
    watered: { today: watered.last === today, count: watered.count },
    fed: { today: fed.last === today, count: fed.count },
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const body = await req.json()

  if (body.habitId && body.plantType) {
    const key = `garden:plant:${body.habitId}`
    const value = String(body.plantType)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, ${key}, ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
    return NextResponse.json({ ok: true })
  }

  // Daily watering ritual — one tap per day, +5 XP each (see computeXp)
  if (body.water === true) {
    // The user's day, not the server's: on UTC the lock only lifted at 02:00
    // local, so the first two hours of a new day still counted as yesterday.
    const today = localDateStr(await getUserTimezone(userId))
    const row = await prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'garden:watered'
    `.catch(() => [] as { value: string }[])
    let watered = { count: 0, last: "" }
    try { if (row[0]) watered = { count: 0, last: "", ...JSON.parse(row[0].value) } } catch {}
    if (watered.last === today) {
      return NextResponse.json({ ok: true, already: true, count: watered.count })
    }
    watered = { count: watered.count + 1, last: today }
    const value = JSON.stringify(watered)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'garden:watered', ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
    return NextResponse.json({ ok: true, already: false, count: watered.count })
  }

  // Daily feeding ritual — the animals gather at the bowl, +5 XP (see computeXp)
  if (body.feed === true) {
    const today = localDateStr(await getUserTimezone(userId))
    const row = await prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'garden:fed'
    `.catch(() => [] as { value: string }[])
    let fed = { count: 0, last: "" }
    try { if (row[0]) fed = { count: 0, last: "", ...JSON.parse(row[0].value) } } catch {}
    if (fed.last === today) {
      return NextResponse.json({ ok: true, already: true, count: fed.count })
    }
    fed = { count: fed.count + 1, last: today }
    const value = JSON.stringify(fed)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'garden:fed', ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
    return NextResponse.json({ ok: true, already: false, count: fed.count })
  }

  // Tile-grid layout: user-arranged object positions from garden edit mode.
  // Only {placed: {objectId: {x, y}}} is stored; ground/structures derive from level.
  if (body.layout && typeof body.layout === "object") {
    const placed: Record<string, { x: number; y: number }> = {}
    const entries = Object.entries((body.layout.placed ?? {}) as Record<string, unknown>).slice(0, 100)
    for (const [id, pos] of entries) {
      if (typeof id !== "string" || id.length > 80 || !pos || typeof pos !== "object") continue
      const { x, y } = pos as { x?: unknown; y?: unknown }
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue
      if ((x as number) < 0 || (x as number) > 31 || (y as number) < 0 || (y as number) > 31) continue
      placed[id] = { x: x as number, y: y as number }
    }
    const value = JSON.stringify({ placed })
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'garden:layout', ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
    return NextResponse.json({ ok: true })
  }

  if (Array.isArray(body.decorations)) {
    // Only earned decorations can be placed
    const row = await prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'garden:unlocked'
    `.catch(() => [] as { value: string }[])
    let unlocked: string[] = []
    try { if (row[0]) unlocked = JSON.parse(row[0].value) } catch {}
    const filtered = body.decorations.filter((d: unknown) => typeof d === "string" && unlocked.includes(d))
    const value = JSON.stringify(filtered)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'garden:decorations', ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
    return NextResponse.json({ ok: true, decorations: filtered })
  }

  return NextResponse.json({ error: "Invalid body" }, { status: 400 })
}
