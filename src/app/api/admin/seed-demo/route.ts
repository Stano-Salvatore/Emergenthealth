import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Creates and fills the demo account used for Play Store review.
//
// A reviewer must be able to see a working app. Handing over a real Google
// account is fragile (Google challenges datacentre sign-ins) and a fresh empty
// account is worse — it lands in onboarding and then shows blank screens, which
// reads as a broken app. So this builds a self-contained account with a month
// of plausible history behind it.
//
// Owner-only, and re-runnable: every call wipes the demo account's data and
// rebuilds it, so a reviewer poking around never leaves it in a odd state.
//
// Point DEMO_EMAIL at the address below and set DEMO_USERNAME / DEMO_PASSWORD
// to give the reviewer a login.

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@emergenthealth.app"
const DAYS = 30

// Deterministic pseudo-randomness: the same demo data every rebuild, so what a
// reviewer sees matches what the screenshots show.
function makeRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

// A date at UTC midnight, n days before today — matching how @db.Date columns
// are stored elsewhere in the app.
function dayAgo(n: number): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

function isoDay(n: number): string {
  return dayAgo(n).toISOString().slice(0, 10)
}

const HABITS = [
  { name: "Morning walk",    color: "#22c55e", icon: null,  reminderTime: "07:30", skipEvery: 6 },
  { name: "Read 20 minutes", color: "#6366f1", icon: null,  reminderTime: "21:00", skipEvery: 4 },
  { name: "Stretch",         color: "#f59e0b", icon: null,  reminderTime: null,    skipEvery: 3 },
  { name: "Vitamin D",       color: "#22c55e", icon: "🌿",  reminderTime: "08:00", skipEvery: 9 },
  { name: "Magnesium",       color: "#22c55e", icon: "🌿",  reminderTime: "22:00", skipEvery: 7 },
]

const JOURNAL = [
  "Slept badly but the walk sorted my head out. Worth remembering.",
  "Good deep-work morning. Kept the phone in the other room.",
  "Late coffee again — took ages to drop off. Cut-off is 2pm, clearly.",
  "Long day, still got the stretch in. Small wins.",
  "Best sleep in a fortnight. Early night actually works.",
]

const INTENTIONS = [
  "Finish the draft before lunch",
  "Get outside before the rain",
  "One thing at a time today",
  "Be off the laptop by 7",
  "Slow morning, no rushing",
]

export async function POST() {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ownerEmail = process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL
  if (!ownerEmail || session.user.email !== ownerEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // ── The account itself ────────────────────────────────────────────────────
  let user = await prisma.user.findFirst({ where: { email: DEMO_EMAIL } })
  if (!user) {
    user = await prisma.user.create({
      data: { name: "Alex Demo", email: DEMO_EMAIL, emailVerified: new Date() },
    })
  }
  const userId = user.id

  // ── Clear anything from a previous run or a reviewer's poking ─────────────
  await prisma.habitCompletion.deleteMany({ where: { userId } })
  await prisma.habit.deleteMany({ where: { userId } })
  await prisma.healthLog.deleteMany({ where: { userId } })
  await prisma.moodLog.deleteMany({ where: { userId } })
  await prisma.dailyNote.deleteMany({ where: { userId } })
  await prisma.intakeLog.deleteMany({ where: { userId } })
  await prisma.chatMessage.deleteMany({ where: { userId } }).catch(() => null)
  await prisma.chatConversation.deleteMany({ where: { userId } }).catch(() => null)
  await prisma.$executeRaw`DELETE FROM "MorningCheckIn" WHERE "userId" = ${userId}`.catch(() => null)

  const rng = makeRng(20260809)

  // ── A month of wearable history ───────────────────────────────────────────
  const healthRows = []
  for (let i = 0; i < DAYS; i++) {
    const weekend = [0, 6].includes(dayAgo(i).getUTCDay())
    healthRows.push({
      userId,
      date: dayAgo(i),
      // Minutes. Longer at weekends, with day-to-day variation to make the
      // charts and the correlation engine show something real.
      sleepDuration: Math.round((weekend ? 450 : 405) + rng() * 90 - 30),
      deepSleep: Math.round(60 + rng() * 35),
      remSleep: Math.round(75 + rng() * 40),
      steps: Math.round((weekend ? 9500 : 7200) + rng() * 4000),
      caloriesBurned: Math.round(2100 + rng() * 500),
      activeMinutes: Math.round(35 + rng() * 45),
      restingHR: Math.round(54 + rng() * 8),
      hrv: Math.round(48 + rng() * 26),
      readinessScore: Math.round(68 + rng() * 26),
      sleepScore: Math.round(70 + rng() * 25),
      weight: Math.round((78 + rng() * 1.4) * 10) / 10,
    })
  }
  await prisma.healthLog.createMany({ data: healthRows, skipDuplicates: true })

  // ── Habits, with streaks that aren't suspiciously perfect ────────────────
  for (const h of HABITS) {
    const habit = await prisma.habit.create({
      data: {
        userId, name: h.name, color: h.color, icon: h.icon,
        reminderTime: h.reminderTime,
      },
    })
    const completions = []
    for (let i = 0; i < DAYS; i++) {
      if (i % h.skipEvery === 0) continue // the odd missed day
      completions.push({ habitId: habit.id, userId, date: dayAgo(i) })
    }
    await prisma.habitCompletion.createMany({ data: completions, skipDuplicates: true })
  }

  // ── Mood, journal, check-ins, intake ─────────────────────────────────────
  await prisma.moodLog.createMany({
    data: Array.from({ length: DAYS }, (_, i) => ({
      userId, date: dayAgo(i), mood: 3 + Math.round(rng() * 1.6),
    })),
    skipDuplicates: true,
  })

  await prisma.dailyNote.createMany({
    data: JOURNAL.map((content, i) => ({ userId, date: dayAgo(i * 3 + 1), content })),
    skipDuplicates: true,
  })

  for (let i = 0; i < INTENTIONS.length; i++) {
    await prisma.$executeRaw`
      INSERT INTO "MorningCheckIn" ("id","userId","date","energy","mood","intention","waterGoalMl","createdAt")
      VALUES (${`demo_ci_${i}`}, ${userId}, ${isoDay(i)}, ${3 + (i % 3)}, ${3 + (i % 2)},
              ${INTENTIONS[i]}, 2000, NOW())
      ON CONFLICT ("userId","date") DO NOTHING
    `.catch(() => null)
  }

  // Drinks across the last week, at plausible times of day
  const intake = []
  for (let i = 0; i < 7; i++) {
    const base = dayAgo(i).getTime()
    const pours: [string, number, number][] = [
      ["coffee", 200, 8], ["water", 500, 10], ["water", 500, 13],
      ["tea", 250, 16], ["water", 400, 19],
    ]
    for (const [type, amountMl, hour] of pours) {
      intake.push({ userId, type, amountMl, loggedAt: new Date(base + hour * 3600_000) })
    }
  }
  await prisma.intakeLog.createMany({ data: intake })

  // Onboarding + timezone, so the reviewer lands on the dashboard rather than
  // being sent through the setup flow.
  for (const [key, value] of [["onboarding_completed", "true"], ["timezone", "Europe/Bratislava"]]) {
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId}, ${key}, ${value})
      ON CONFLICT ("userId","key") DO UPDATE SET "value" = ${value}
    `.catch(() => null)
  }

  return NextResponse.json({
    ok: true,
    email: DEMO_EMAIL,
    userId,
    seeded: {
      days: DAYS,
      habits: HABITS.length,
      healthLogs: healthRows.length,
      journal: JOURNAL.length,
      checkins: INTENTIONS.length,
      intake: intake.length,
    },
  })
}
