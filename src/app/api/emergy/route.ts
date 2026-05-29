import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { subDays } from "date-fns"

export type EmergyState = "thriving" | "happy" | "okay" | "tired" | "wilting" | "screaming"

interface Level { level: number; name: string; emoji: string; minXp: number; nextXp: number }

const LEVELS: Level[] = [
  { level: 1, name: "Seed",    emoji: "🌱", minXp: 0,    nextXp: 100  },
  { level: 2, name: "Sprout",  emoji: "🌿", minXp: 100,  nextXp: 300  },
  { level: 3, name: "Plant",   emoji: "🍃", minXp: 300,  nextXp: 700  },
  { level: 4, name: "Bush",    emoji: "🌺", minXp: 700,  nextXp: 1500 },
  { level: 5, name: "Flower",  emoji: "🌸", minXp: 1500, nextXp: 3000 },
  { level: 6, name: "Tree",    emoji: "🌳", minXp: 3000, nextXp: 9999 },
]

function getLevel(xp: number): Level {
  return [...LEVELS].reverse().find(l => xp >= l.minXp) ?? LEVELS[0]
}

// Screaming messages
const SCREAM_WATER = [
  "I'M SO THIRSTY PLEASE DRINK SOMETHING 💧",
  "HELLO?? WATER?? ANYONE HOME??",
  "it's been hours and zero water bestie 🥲",
]
const SCREAM_HABITS = [
  "THE HABITS AREN'T GOING TO COMPLETE THEMSELVES 🚨",
  "EXCUSE ME YOU FORGOT YOUR HABITS??",
  "we're running out of day!! complete your habits!! 😤",
]
const HAPPY_MSG = [
  "you're doing amazing!! i'm so proud 🌸",
  "look how healthy we both are!! 💪",
  "your streaks are making me BLOOM 🌺",
  "great sleep last night hehe 😌",
  "hydration check: absolutely stellar ✅",
]
const TIRED_MSG = [
  "maybe go to bed a little earlier tonight? 🥺",
  "i noticed your sleep was rough... 😴",
  "we both could use some rest, hm?",
]
const OKAY_MSG = [
  "hey!! how are you doing today? 👀",
  "don't forget to drink some water~",
  "your habits are waiting for you!",
  "i believe in you today 🌱",
  "small steps still count, you know 🍃",
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Date.now() / 30_000) % arr.length]
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const since90 = subDays(today, 90)

  const [todayHealth, todayWater, todayHabitsDone, totalHabits, xpRaw] = await Promise.all([
    prisma.healthLog.findFirst({
      where: { userId, date: { gte: today } },
      select: { sleepScore: true, readinessScore: true },
    }).catch(() => null),

    prisma.intakeLog.findMany({
      where: { userId, type: "water", loggedAt: { gte: today } },
      select: { amountMl: true },
    }).catch(() => [] as { amountMl: number }[]),

    prisma.habitCompletion.count({ where: { userId, date: { gte: today } } }).catch(() => 0),
    prisma.habit.count({ where: { userId, isArchived: false } }).catch(() => 0),

    Promise.all([
      prisma.habitCompletion.count({ where: { userId, date: { gte: since90 } } }).catch(() => 0),
      prisma.intakeLog.count({ where: { userId, type: "water", loggedAt: { gte: since90 } } }).catch(() => 0),
      prisma.healthLog.count({ where: { userId, date: { gte: since90 }, sleepScore: { gte: 70 } } }).catch(() => 0),
      prisma.healthLog.count({ where: { userId, date: { gte: since90 }, readinessScore: { gte: 75 } } }).catch(() => 0),
      prisma.moodLog.count({ where: { userId, date: { gte: since90 } } }).catch(() => 0),
    ]),
  ])

  const [habits90, water90, goodSleep90, goodReadiness90, mood90] = xpRaw
  const xp = habits90 * 15 + water90 * 10 + goodSleep90 * 20 + goodReadiness90 * 25 + mood90 * 5
  const levelInfo = getLevel(xp)

  const waterMl    = todayWater.reduce((s: number, l: { amountMl: number }) => s + l.amountMl, 0)
  const sleepScore = todayHealth?.sleepScore ?? null
  const readiness  = todayHealth?.readinessScore ?? null
  const habitsPct  = totalHabits > 0 ? (todayHabitsDone / totalHabits) * 100 : null
  const hour       = new Date().getHours()

  // ── Determine state ────────────────────────────────────────────────────
  let state: EmergyState
  let message: string

  const screamWater  = hour >= 16 && waterMl < 300
  const screamHabits = hour >= 21 && habitsPct !== null && habitsPct < 50

  if (screamWater) {
    state = "screaming"; message = pick(SCREAM_WATER)
  } else if (screamHabits) {
    state = "screaming"; message = pick(SCREAM_HABITS)
  } else {
    const scores = [
      sleepScore ?? 64,
      readiness  ?? 64,
      waterMl >= 1500 ? 88 : waterMl >= 800 ? 72 : waterMl >= 300 ? 56 : 38,
      habitsPct ?? 60,
    ]
    const avg = scores.reduce((a, b) => a + b) / scores.length

    if      (avg >= 78) { state = "thriving"; message = pick(HAPPY_MSG) }
    else if (avg >= 65) { state = "happy";    message = pick(HAPPY_MSG)  }
    else if (avg >= 52) { state = "okay";     message = pick(OKAY_MSG)   }
    else if (avg >= 40) { state = "tired";    message = pick(TIRED_MSG)  }
    else                { state = "wilting";  message = pick(TIRED_MSG)  }
  }

  return NextResponse.json({
    state,
    message,
    waterMl,
    sleepScore,
    readinessScore: readiness,
    habitsDone: todayHabitsDone,
    totalHabits,
    habitsPct,
    xp,
    level: levelInfo.level,
    levelName: levelInfo.name,
    levelEmoji: levelInfo.emoji,
    minXp: levelInfo.minXp,
    nextXp: levelInfo.nextXp,
  })
}
