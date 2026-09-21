import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { userDay } from "@/lib/user-timezone"
import { localTimeStr, zonedDayRange } from "@/lib/local-date"
import { NextResponse } from "next/server"
import { computeXp, getLevel } from "@/lib/xp"
import { sumHydration, HYDRATING_TYPES } from "@/lib/hydration"

export type EmergyState = "thriving" | "happy" | "okay" | "tired" | "wilting" | "screaming"

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
  return arr[Math.floor(Math.random() * arr.length)]
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { timezone, dateColumn, start } = await userDay(userId)

  // The wall-clock hour drives two things below: the screaming thresholds,
  // and — new — which day is being judged at all.
  const hourNow = Number(localTimeStr(timezone).slice(0, 2))

  // Before five in the morning, the day being lived is still yesterday.
  //
  // At 23:58 the avatar was thriving on a full day of water, habits and a
  // 5/5 mood; at 00:05, seven minutes later, it was grey — because midnight
  // reset every counter to zero and the empty ledger averaged out as
  // "tired". Nobody's evening ends at midnight, and a companion that slumps
  // the moment the date changes reads as sulking at exactly the wrong
  // moment. Until 05:00 local — before anyone's day has honestly started —
  // the scores are yesterday's, the day that is still being lived. The
  // screaming thresholds are wall-clock-gated at 16:00 and 21:00, so they
  // cannot fire in that window either way.
  let today = dateColumn
  let dayStart = start
  if (hourNow < 5) {
    const y = new Date(dateColumn.getTime() - 24 * 60 * 60 * 1000)
    const yStr = y.toISOString().slice(0, 10)
    today = new Date(yStr + "T00:00:00Z")
    dayStart = zonedDayRange(timezone, yStr).start
  }

  const [[todayHealth, todayWater, todayHabitsDone, totalHabits], xpBreakdown] = await Promise.all([
    Promise.all([
      prisma.healthLog.findFirst({
        where: { userId, date: { gte: today } },
        // Ascending, and not as a nicety: pre-dawn the window spans two days,
        // and the one with a whole night's scores in it is the earlier one —
        // findFirst without an order would pick whichever the planner felt
        // like, which is the same avatar flickering between moods on refresh.
        orderBy: { date: "asc" },
        select: { sleepScore: true, readinessScore: true },
      }).catch(() => null),
      prisma.intakeLog.findMany({
        where: { userId, type: { in: HYDRATING_TYPES }, loggedAt: { gte: dayStart } },
        select: { amountMl: true, type: true },
      }).catch(() => [] as { amountMl: number; type: string }[]),
      prisma.habitCompletion.count({ where: { userId, date: { gte: today } } }).catch(() => 0),
      prisma.habit.count({ where: { userId, isArchived: false } }).catch(() => 0),
    ]),
    computeXp(userId),
  ])

  const xp = xpBreakdown.total
  const levelInfo = getLevel(xp)

  const waterMl    = sumHydration(todayWater)
  const sleepScore = todayHealth?.sleepScore ?? null
  const readiness  = todayHealth?.readinessScore ?? null
  const habitsPct  = totalHabits > 0 ? (todayHabitsDone / totalHabits) * 100 : null
  // The screaming thresholds are wall-clock hours — the user's wall clock.
  const hour       = hourNow

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
    levelName: levelInfo.levelName,
    levelEmoji: levelInfo.levelEmoji,
    minXp: levelInfo.minXp,
    nextXp: levelInfo.nextXp,
    progress: levelInfo.progress,
    xpToNext: levelInfo.xpToNext,
    xpBreakdown,
  })
}
