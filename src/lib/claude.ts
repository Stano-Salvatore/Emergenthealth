/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/prisma"
import { getEventsInRange } from "@/lib/google-calendar"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { estimateCaffeine, activeFromDoses, HALF_LIFE_H } from "@/lib/caffeine"
import { getPersonalCaffeineProfile } from "@/lib/caffeine-profile"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { hydrationMl, HYDRATION_FACTOR } from "@/lib/hydration"

/** Fold whatever the model called it onto a type the app stores. */
function normalizeDrinkType(raw: string): string {
  const t = raw.trim().toLowerCase()
  if (t in HYDRATION_FACTOR) return t
  if (/mate|yerba|guayusa/.test(t)) return "mate"
  if (/coffee|espresso|latte|americano/.test(t)) return "coffee"
  if (/tea/.test(t)) return "tea"
  if (/beer|lager|ale/.test(t)) return "beer"
  if (/wine/.test(t)) return "wine"
  if (/vodka|whisk|gin|rum|spirit/.test(t)) return "spirits"
  return "other"
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const CACHE: Anthropic.CacheControlEphemeral = { type: "ephemeral" }

// Mark last tool as cacheable so the static tool definitions are cached together
const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_habit",
    description: "Create a new daily habit for the user to track",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name of the habit" },
        color: { type: "string", description: "Hex color e.g. #6366f1 (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "complete_habit_today",
    description: "Mark a habit as completed for today",
    input_schema: {
      type: "object" as const,
      properties: {
        habitName: { type: "string", description: "Name of the habit to complete" },
      },
      required: ["habitName"],
    },
  },
  {
    name: "create_reminder",
    description: "Create a reminder for the user",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        dueDate: { type: "string", description: "Date in YYYY-MM-DD format (optional)" },
        priority: { type: "string", enum: ["low", "normal", "high"] },
      },
      required: ["title"],
    },
  },
  {
    name: "log_water",
    description: "Log water intake for the user (adds to today's total)",
    input_schema: {
      type: "object" as const,
      properties: {
        amountMl: { type: "number", description: "Amount in millilitres (e.g. 250, 500, 1000)" },
      },
      required: ["amountMl"],
    },
  },
  {
    name: "log_coffee",
    description: "Log coffee intake for the user (adds to today's coffee total)",
    input_schema: {
      type: "object" as const,
      properties: {
        amountMl: { type: "number", description: "Amount in ml (e.g. 30 espresso, 200 americano, 300 latte)" },
      },
      required: ["amountMl"],
    },
  },
  {
    // Named drinks — including branded ones the app has never heard of.
    // There's no product database and there doesn't need to be: the model
    // already knows roughly what's in a yerba mate or a can of Club-Mate, and
    // supplying that estimate here is more useful than a lookup table that
    // covers eight drinks and nothing local. Values are sanity-checked server
    // side, and the estimate is stated back so an implausible one is visible
    // rather than silently stored.
    name: "log_drink",
    description:
      "Log any drink by name, including branded or regional products (e.g. 'Maté by Mana Roots', 'Club-Mate', 'Kofola'). Use this instead of log_water/log_coffee whenever the user names a specific drink. Estimate the caffeine yourself from what you know of the product — do not ask the user for milligrams.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "What the user called it, e.g. 'Maté by Mana Roots'" },
        drinkType: {
          type: "string",
          description: "One of: water, sparkling, coffee, tea, matcha, mate, juice, soda, milk, beer, wine, spirits, alcohol, other",
        },
        amountMl: { type: "number", description: "Volume in millilitres. Estimate a typical serving if the user didn't say." },
        caffeineMg: {
          type: "number",
          description: "Estimated caffeine for this serving, 0 if none. Yerba mate is roughly 0.15 mg/ml (~80mg per 500ml) — well under coffee's 0.4.",
        },
      },
      required: ["name", "drinkType", "amountMl"],
    },
  },
  {
    name: "log_food",
    description:
      "Log something the user says they ate, by name. Estimate the calories and macros yourself from what you know of the dish — do not ask the user for numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Short dish name, e.g. 'Chicken caesar salad'" },
        mealType: { type: "string", description: "breakfast | lunch | dinner | snack | other" },
        calories: { type: "number", description: "Estimated kcal for the portion described" },
        proteinG: { type: "number" },
        carbsG: { type: "number" },
        fatG: { type: "number" },
      },
      required: ["name", "calories"],
    },
  },
  {
    name: "log_usual",
    description: "Log the user's usual order at one of their saved places — e.g. 'log my usual' or 'log my usual at Vták' logs the drink they've stored for that café, feeding the intake and caffeine trackers. Without a place name it uses the place they most recently checked in at that has a usual set.",
    input_schema: {
      type: "object" as const,
      properties: {
        placeName: { type: "string", description: "Saved place name or a part of it (optional)" },
      },
      required: [],
    },
  },
  {
    name: "log_mood",
    description: "Log the user's mood for today (1=awful, 2=bad, 3=ok, 4=good, 5=great)",
    input_schema: {
      type: "object" as const,
      properties: {
        mood: { type: "number", description: "Mood score 1-5" },
      },
      required: ["mood"],
    },
  },
  {
    name: "log_weight",
    description: "Log the user's body weight in kg for today",
    input_schema: {
      type: "object" as const,
      properties: {
        weightKg: { type: "number", description: "Weight in kilograms" },
      },
      required: ["weightKg"],
    },
  },
  {
    name: "write_daily_note",
    description: "Write or update the user's journal note for today",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "The note content to save" },
      },
      required: ["content"],
    },
  },
  {
    name: "log_morning_checkin",
    description: "Log the user's morning check-in: energy level, mood, optional intention/focus, and water goal",
    input_schema: {
      type: "object" as const,
      properties: {
        energy: { type: "number", description: "Energy level 1-5 (1=exhausted, 3=ok, 5=amazing)" },
        mood: { type: "number", description: "Mood 1-5 (1=awful, 3=neutral, 5=great)" },
        intention: { type: "string", description: "Today's focus or intention (optional)" },
        waterGoalMl: { type: "number", description: "Water goal in ml (default 2000)" },
      },
      required: ["energy", "mood"],
    },
  },
  {
    name: "get_health_range",
    description: "Read the user's full daily history over the last N days: health metrics (sleep, resting HR, HRV, readiness, steps), Oura Ring tags (coffee, supplements, meds, alcohol — the user logs these in the Oura app), morning check-ins (energy/mood/intention), mood logs, journal notes, and logged water/coffee. Use this to answer questions about trends and causes — e.g. 'does coffee affect my sleep', 'how did I feel that week'. Reason over the returned data instead of guessing.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "How many days back to fetch (1-90)" },
      },
      required: ["days"],
    },
  },
  {
    name: "remember",
    description: "Save a durable fact about the user (a goal, preference, or context) so you recall it in future conversations. Use when the user shares something worth remembering long-term, e.g. 'I'm training for a marathon' or 'I hate mornings'.",
    input_schema: {
      type: "object" as const,
      properties: {
        fact: { type: "string", description: "The fact to remember, in a short sentence" },
      },
      required: ["fact"],
    },
  },
]

async function executeTool(name: string, input: Record<string, string>, userId: string): Promise<string> {
  if (name === "create_habit") {
    await prisma.habit.create({
      data: { userId, name: input.name, color: input.color ?? "#6366f1" },
    })
    return `Created habit "${input.name}".`
  }

  if (name === "complete_habit_today") {
    const habit = await prisma.habit.findFirst({
      where: { userId, name: { contains: input.habitName, mode: "insensitive" }, isArchived: false },
    })
    if (!habit) return `No habit found matching "${input.habitName}".`
    const today = new Date(); today.setHours(0, 0, 0, 0)
    await prisma.habitCompletion.upsert({
      where: { habitId_date: { habitId: habit.id, date: today } },
      create: { habitId: habit.id, userId, date: today },
      update: {},
    })
    return `Marked "${habit.name}" as complete for today.`
  }

  if (name === "create_reminder") {
    await prisma.reminder.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        priority: input.priority ?? "normal",
      },
    })
    return `Created reminder "${input.title}".`
  }

  if (name === "log_water") {
    const amountMl = parseInt(String(input.amountMl), 10)
    await prisma.intakeLog.create({ data: { userId, type: "water", amountMl } }).catch(() => null)
    return `Logged ${amountMl}ml of water.`
  }

  if (name === "log_coffee") {
    const amountMl = parseInt(String(input.amountMl), 10)
    const log = await prisma.intakeLog.create({ data: { userId, type: "coffee", amountMl } }).catch(() => null)
    if (log) {
      const est = estimateCaffeine("coffee", "", amountMl)
      if (est) {
        await prisma.caffeineLog.create({
          data: { id: `intake_${log.id}`, userId, compound: est.compound, caffeineMg: est.mg },
        }).catch(() => null)
      }
    }
    return `Logged ${amountMl}ml of coffee.`
  }

  if (name === "log_drink") {
    const label = String(input.name ?? "").trim().slice(0, 120) || "Drink"
    const type = normalizeDrinkType(String(input.drinkType ?? "other"))
    const amountMl = clampInt(input.amountMl, 1, 5000, 250)

    // The model's caffeine figure is an estimate, not a measurement, so it gets
    // a ceiling: nothing in a glass is 2000mg, and an outlier propagates
    // straight into body-load and the "still circulating at bedtime" chart.
    const rawMg = input.caffeineMg == null ? null : Number(input.caffeineMg)
    const caffeineMg = rawMg == null || !Number.isFinite(rawMg)
      ? null
      : Math.max(0, Math.min(600, Math.round(rawMg)))

    const log = await prisma.intakeLog.create({
      data: { userId, type, amountMl, note: label },
    }).catch(() => null)
    if (!log) return "Couldn't save that drink — the log didn't write."

    if (caffeineMg && caffeineMg > 0) {
      await prisma.caffeineLog.create({
        data: { id: `intake_${log.id}`, userId, compound: type, caffeineMg },
      }).catch(() => {})
    }

    const fluid = hydrationMl(type, amountMl)
    const parts = [`Logged ${amountMl}ml ${label}`]
    if (caffeineMg && caffeineMg > 0) parts.push(`≈${caffeineMg}mg caffeine`)
    if (fluid !== amountMl) parts.push(`counts as ${fluid}ml fluid`)
    else parts.push(`${fluid}ml toward hydration`)
    return parts.join(" · ") + "."
  }

  if (name === "log_food") {
    const label = String(input.name ?? "").trim().slice(0, 120)
    if (!label) return "Need a name for the meal."
    const calories = clampInt(input.calories, 0, 10_000, 0)
    const macro = (v: unknown) => {
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null
    }
    await prisma.foodLog.create({
      data: {
        userId,
        name: label,
        mealType: ["breakfast", "lunch", "dinner", "snack"].includes(String(input.mealType))
          ? String(input.mealType) : "other",
        calories,
        proteinG: macro(input.proteinG),
        carbsG: macro(input.carbsG),
        fatG: macro(input.fatG),
      },
    }).catch(() => null)
    return `Logged ${label} — ≈${calories} kcal. (Estimated from the name, so treat it as a ballpark.)`
  }

  if (name === "log_usual") {
    const places = await prisma.savedPlace.findMany({ where: { userId } })
    const withUsual = places.filter(p => p.usualType && p.usualMl)
    if (withUsual.length === 0) {
      return "No saved place has a usual order yet — one can be set from the place banner on the dashboard (⭐ Save place → pick the usual)."
    }
    let place: (typeof withUsual)[number] | null = null
    const q = (input.placeName ?? "").trim().toLowerCase()
    if (q) {
      place = withUsual.find(p => p.name.toLowerCase().includes(q)) ?? null
      if (!place) {
        return `No saved place matching "${input.placeName}" has a usual order. Places with a usual: ${withUsual.map(p => p.name).join(", ")}.`
      }
    } else {
      // default to where they last checked in; unambiguous single place also works
      const lastCheckin = await prisma.checkIn.findFirst({
        where: { userId, savedPlaceId: { in: withUsual.map(p => p.id) } },
        orderBy: { checkedAt: "desc" },
      }).catch(() => null)
      place = withUsual.find(p => p.id === lastCheckin?.savedPlaceId)
        ?? (withUsual.length === 1 ? withUsual[0] : null)
      if (!place) {
        return `Which place? Usuals are set at: ${withUsual.map(p => p.name).join(", ")}. Ask the user, then call log_usual with the placeName.`
      }
    }
    const log = await prisma.intakeLog.create({
      data: {
        userId,
        type: place.usualType!,
        amountMl: place.usualMl!,
        note: `${place.usualNote || "the usual"} @ ${place.name}`,
        loggedAt: new Date(),
      },
    })
    // same mirroring the intake API does, same deterministic id convention
    const est = estimateCaffeine(place.usualType!, place.usualNote ?? "", place.usualMl!)
    if (est) {
      await prisma.caffeineLog.create({
        data: { id: `intake_${log.id}`, userId, compound: est.compound, caffeineMg: est.mg },
      }).catch(() => null)
    }
    return `Logged the usual at ${place.name}: ${place.usualNote || place.usualType}, ${place.usualMl} ml.${est ? ` Tracked ${est.mg} mg caffeine.` : ""}`
  }

  if (name === "log_mood") {
    const mood = Math.min(5, Math.max(1, parseInt(String(input.mood), 10)))
    const today = new Date(); today.setHours(0, 0, 0, 0)
    await prisma.moodLog.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, mood },
      update: { mood },
    }).catch(() => null)
    return `Logged mood: ${mood}/5 for today.`
  }

  if (name === "log_weight") {
    const weight = parseFloat(String(input.weightKg))
    const today = new Date(); today.setHours(0, 0, 0, 0)
    await prisma.healthLog.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, weight },
      update: { weight },
    }).catch(() => null)
    return `Logged weight: ${weight}kg for today.`
  }

  if (name === "write_daily_note") {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split("T")[0]
    await prisma.$executeRaw`
      INSERT INTO "DailyNote" ("id","userId","date","content","updatedAt")
      VALUES (gen_random_uuid()::text, ${userId}, ${todayStr}::date, ${input.content}, NOW())
      ON CONFLICT ("userId","date") DO UPDATE SET "content" = ${input.content}, "updatedAt" = NOW()
    `.catch(() => null)
    return `Journal note saved for today.`
  }

  if (name === "log_morning_checkin") {
    const energy = Math.min(5, Math.max(1, parseInt(String(input.energy), 10)))
    const mood = Math.min(5, Math.max(1, parseInt(String(input.mood), 10)))
    const intention = input.intention?.trim() || null
    const waterGoalMl = parseInt(String(input.waterGoalMl ?? 2000), 10)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split("T")[0]
    const id = `mci_${userId}_${todayStr}`
    await prisma.$executeRaw`
      INSERT INTO "MorningCheckIn" ("id","userId","date","energy","mood","intention","waterGoalMl")
      VALUES (${id}, ${userId}, ${todayStr}, ${energy}, ${mood}, ${intention}, ${waterGoalMl})
      ON CONFLICT ("userId","date") DO UPDATE SET
        "energy" = EXCLUDED."energy", "mood" = EXCLUDED."mood",
        "intention" = EXCLUDED."intention", "waterGoalMl" = EXCLUDED."waterGoalMl"
    `.catch(() => null)
    const energyLabels: Record<number, string> = { 1: "exhausted", 2: "tired", 3: "ok", 4: "good", 5: "amazing" }
    const moodLabels: Record<number, string> = { 1: "awful", 2: "bad", 3: "ok", 4: "good", 5: "great" }
    return `Morning check-in logged! Energy: ${energy}/5 (${energyLabels[energy]}), Mood: ${mood}/5 (${moodLabels[mood]})${intention ? `, Intention: "${intention}"` : ""}.`
  }

  if (name === "get_health_range") {
    const days = Math.min(90, Math.max(1, parseInt(String(input.days), 10) || 7))
    const since = new Date(); since.setDate(since.getDate() - days); since.setHours(0, 0, 0, 0)
    const sinceStr = since.toISOString().split("T")[0]
    const [logs, tags, checkins, notes, moods, intake] = await Promise.all([
      prisma.healthLog.findMany({
        where: { userId, date: { gte: since } },
        orderBy: { date: "desc" },
        select: {
          date: true, sleepDuration: true, sleepScore: true, restingHR: true,
          hrv: true, readinessScore: true, steps: true, activityScore: true,
        },
      }).catch(() => [] as any[]),
      prisma.$queryRaw<{ day: string; tagName: string | null; text: string | null }[]>`
        SELECT "day","tagName","text" FROM "OuraTag"
        WHERE "userId" = ${userId} AND "day" >= ${sinceStr} ORDER BY "timestamp"
      `.catch(() => []),
      prisma.$queryRaw<{ date: string; energy: number; mood: number; intention: string | null }[]>`
        SELECT "date","energy","mood","intention" FROM "MorningCheckIn"
        WHERE "userId" = ${userId} AND "date" >= ${sinceStr}
      `.catch(() => []),
      prisma.dailyNote.findMany({
        where: { userId, date: { gte: since } },
        select: { date: true, content: true },
      }).catch(() => [] as { date: Date; content: string }[]),
      prisma.moodLog.findMany({
        where: { userId, date: { gte: since } },
        select: { date: true, mood: true },
      }).catch(() => [] as { date: Date; mood: number }[]),
      prisma.intakeLog.findMany({
        where: { userId, loggedAt: { gte: since } },
        select: { loggedAt: true, type: true, amountMl: true },
      }).catch(() => [] as { loggedAt: Date; type: string; amountMl: number }[]),
    ])

    const tagsByDay = new Map<string, string[]>()
    for (const t of tags) {
      const label = (t.tagName ?? t.text ?? "").trim()
      if (!label) continue
      const list = tagsByDay.get(t.day) ?? []
      list.push(label)
      tagsByDay.set(t.day, list)
    }
    const checkinByDay = new Map(checkins.map(c => [c.date, c]))
    const noteByDay = new Map(notes.map(n => [n.date.toISOString().split("T")[0], n.content]))
    const moodByDay = new Map(moods.map(m => [m.date.toISOString().split("T")[0], m.mood]))
    const intakeByDay = new Map<string, { water: number; coffee: number }>()
    for (const i of intake) {
      const d = i.loggedAt.toISOString().split("T")[0]
      const acc = intakeByDay.get(d) ?? { water: 0, coffee: 0 }
      if (i.type === "water") acc.water += i.amountMl
      else if (i.type === "coffee") acc.coffee += i.amountMl
      intakeByDay.set(d, acc)
    }

    const healthByDay = new Map(logs.map((l: any) => [l.date.toISOString().split("T")[0], l]))
    const allDays = [...new Set([
      ...healthByDay.keys(), ...tagsByDay.keys(), ...checkinByDay.keys(),
      ...noteByDay.keys(), ...moodByDay.keys(), ...intakeByDay.keys(),
    ])].sort().reverse()
    if (allDays.length === 0) return `No data in the last ${days} days.`

    const rows = allDays.map(d => {
      const l = healthByDay.get(d)
      const parts: string[] = []
      if (l) {
        const sleep = l.sleepDuration != null ? `${(l.sleepDuration / 60).toFixed(1)}h` : "?"
        parts.push(`sleep ${sleep}${l.sleepScore != null ? ` (score ${l.sleepScore})` : ""}, restingHR ${l.restingHR ?? "?"}bpm, HRV ${l.hrv != null ? Math.round(l.hrv) + "ms" : "?"}, readiness ${l.readinessScore ?? "?"}, steps ${l.steps ?? "?"}`)
      }
      const dayTags = tagsByDay.get(d)
      if (dayTags?.length) parts.push(`Oura tags: ${dayTags.join(", ")}`)
      const ink = intakeByDay.get(d)
      if (ink && (ink.water > 0 || ink.coffee > 0)) {
        parts.push(`logged:${ink.water > 0 ? ` water ${ink.water}ml` : ""}${ink.coffee > 0 ? ` coffee ${ink.coffee}ml` : ""}`)
      }
      const c = checkinByDay.get(d)
      if (c) parts.push(`check-in: energy ${c.energy}/5, mood ${c.mood}/5${c.intention ? `, intention "${c.intention}"` : ""}`)
      const m = moodByDay.get(d)
      if (m != null) parts.push(`mood ${m}/5`)
      const note = noteByDay.get(d)
      if (note) parts.push(`journal: "${note.length > 160 ? note.slice(0, 160) + "…" : note}"`)
      return `${d}: ${parts.join(" | ")}`
    }).join("\n")
    return `Last ${days} days (most recent first — health, Oura tags, intake, check-ins, mood, journal):\n${rows}`
  }

  if (name === "remember") {
    const fact = String(input.fact ?? "").trim().slice(0, 280)
    if (!fact) return "Nothing to remember."
    const existing = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "emergy_memory" } },
    }).catch(() => null)
    let facts: string[] = []
    try { facts = existing ? JSON.parse(existing.value) : [] } catch { facts = [] }
    if (!facts.includes(fact)) facts.push(fact)
    facts = facts.slice(-50) // keep the 50 most recent
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: "emergy_memory" } },
      create: { userId, key: "emergy_memory", value: JSON.stringify(facts) },
      update: { value: JSON.stringify(facts) },
    }).catch(() => null)
    return `Got it — I'll remember that: "${fact}".`
  }

  return "Unknown tool."
}

export async function buildSystemPrompt(userId: string): Promise<string> {
  const today = new Date()

  // The user's IANA timezone (captured by TimezoneDetector into UserPreference).
  // Calendar events are stored in UTC — without this, times render hours off
  // and "today" flips at the wrong moment.
  const tzRow = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "timezone" } },
  }).catch(() => null)
  const tz = tzRow?.value || "UTC"
  const fmtDay = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" })
  const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
  const fmtDateISO = new Intl.DateTimeFormat("en-CA", { timeZone: tz }) // YYYY-MM-DD

  const todayStr = fmtDateISO.format(today)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const since14 = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
  const since7 = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  const since7Str = fmtDateISO.format(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000))

  const [recentHealth, recentTransactions, habits, upcomingReminders, calendarEvents, todayMood, todayIntake, todayFood, recentOuraTags, recentCheckins, recentScreenTime, caffeineDoses24h] =
    await Promise.all([
      prisma.healthLog.findMany({
        where: { userId }, orderBy: { date: "desc" }, take: 14,
        select: {
          id: true, date: true, sleepDuration: true, deepSleep: true, remSleep: true,
          steps: true, restingHR: true, weight: true, activeMinutes: true, caloriesBurned: true,
          readinessScore: true, hrv: true, spo2: true, activityScore: true, breathingRate: true,
          sleepScore: true,
        },
      }),
      prisma.transaction.findMany({ where: { userId, date: { gte: monthStart } }, orderBy: { date: "desc" }, take: 100 }),
      prisma.habit.findMany({
        where: { userId, isArchived: false },
        include: {
          completions: {
            where: { date: { gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) } },
            orderBy: { date: "desc" },
          },
        },
      }),
      prisma.reminder.findMany({ where: { userId, isCompleted: false }, orderBy: { dueDate: "asc" }, take: 20 }),
      getEventsInRange(
        userId,
        new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      ),
      prisma.moodLog.findFirst({ where: { userId, date: { gte: new Date(todayStr) } } }).catch(() => null),
      prisma.intakeLog.findMany({ where: { userId, loggedAt: { gte: new Date(todayStr) } } }).catch(() => []),
      prisma.foodLog.findMany({
        where: { userId, loggedAt: { gte: new Date(todayStr) } },
        select: { name: true, mealType: true, calories: true, proteinG: true, micros: true },
        orderBy: { loggedAt: "asc" },
      }).catch(() => [] as { name: string; mealType: string; calories: number; proteinG: number | null; micros: unknown }[]),
      prisma.$queryRaw<{ day: string; tagName: string | null; text: string | null }[]>`
        SELECT "day","tagName","text" FROM "OuraTag"
        WHERE "userId" = ${userId} AND "day" >= ${since7Str} ORDER BY "timestamp"
      `.catch(() => []),
      prisma.$queryRaw<{ date: string; energy: number; mood: number; intention: string | null; waterGoalMl: number }[]>`
        SELECT "date","energy","mood","intention","waterGoalMl" FROM "MorningCheckIn"
        WHERE "userId" = ${userId} AND "date" >= ${since7Str} ORDER BY "date" DESC
      `.catch(() => []),
      prisma.screenTimeLog.findMany({
        where: { userId }, orderBy: { date: "desc" }, take: 7,
        select: { date: true, totalMin: true, firstUnlockMin: true },
      }).catch(() => [] as { date: string; totalMin: number; firstUnlockMin: number | null }[]),
      prisma.caffeineLog.findMany({
        where: { userId, loggedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        select: { caffeineMg: true, loggedAt: true },
      }).catch(() => [] as { caffeineMg: number; loggedAt: Date }[]),
    ])

  // Everything below was in the database but invisible to Emergy: he could see
  // that a place called "Gym" existed but not that they had been there, knew
  // their symptoms but not their prescriptions, and had no idea what they were
  // aiming at. Fetched in one batch alongside the rest so the extra sources
  // cost latency once, not seven times.
  const [locationPoints, timelineEvents, focusSessions, medSchedules, books, goals, routines, cachedInsights] = await Promise.all([
    // Raw pings, summarised below rather than listed — there can be thousands
    // a week and none of them mean anything individually.
    prisma.locationPoint.findMany({
      where: { userId, trackedAt: { gte: since7 } },
      orderBy: { trackedAt: "asc" }, take: 3000,
      select: { lat: true, lng: true, trackedAt: true },
    }).catch(() => [] as { lat: number; lng: number; trackedAt: Date }[]),
    prisma.timelineEvent.findMany({
      where: { userId, occurredAt: { gte: since14 } },
      orderBy: { occurredAt: "desc" }, take: 15,
      select: { emoji: true, label: true, note: true, occurredAt: true },
    }).catch(() => [] as { emoji: string; label: string; note: string | null; occurredAt: Date }[]),
    prisma.focusSession.findMany({
      where: { userId, startedAt: { gte: since7 }, type: "focus" },
      orderBy: { startedAt: "desc" }, take: 100,
      select: { durationMin: true, label: true, startedAt: true },
    }).catch(() => [] as { durationMin: number; label: string | null; startedAt: Date }[]),
    prisma.medSchedule.findMany({
      where: { userId, active: true },
      select: { name: true, dose: true, times: true, daysOfWeek: true, note: true, startDate: true, endDate: true },
    }).catch(() => [] as { name: string; dose: string | null; times: string[]; daysOfWeek: number[]; note: string | null; startDate: string | null; endDate: string | null }[]),
    prisma.book.findMany({
      where: { userId, status: { in: ["reading", "done"] } },
      orderBy: { updatedAt: "desc" }, take: 8,
      select: { title: true, author: true, status: true, rating: true, finishedAt: true },
    }).catch(() => [] as { title: string; author: string | null; status: string; rating: number | null; finishedAt: Date | null }[]),
    prisma.userGoals.findUnique({ where: { userId } }).catch(() => null),
    prisma.habitRoutine.findMany({
      where: { userId }, orderBy: { sortOrder: "asc" },
      select: { name: true, emoji: true, habitIds: true },
    }).catch(() => [] as { name: string; emoji: string; habitIds: string[] }[]),
    // The correlation engine tests 51 relationships and puts every one through
    // a permutation test and Benjamini-Hochberg correction — and the results
    // lived on a page. Emergy, the one part of this app that actually talks,
    // could not see a single finding. This reads the cache the insights page
    // and the nightly cron both write, so nothing is recomputed here: a chat
    // message must never trigger a 1000-shuffle run.
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "insights_cache:overall" } },
      select: { value: true },
    }).catch(() => null),
  ])

  const [recentMoods, todayWeather, recentNotes, recentLabs, latestBody, recentWorkouts, recentSymptoms, fastActivePref, fastHistoryPref] = await Promise.all([
    prisma.moodLog.findMany({ where: { userId, date: { gte: since14 } }, orderBy: { date: "desc" } }).catch(() => [] as { date: Date; mood: number }[]),
    prisma.weatherLog.findFirst({
      where: { userId, date: todayStr },
      select: { tempMaxC: true, tempMinC: true, precipMm: true, uvIndex: true, weatherCode: true },
    }).catch(() => null),
    prisma.dailyNote.findMany({
      where: { userId, date: { gte: since14 } },
      orderBy: { date: "desc" }, take: 5,
      select: { date: true, content: true },
    }).catch(() => [] as { date: Date; content: string }[]),
    // High-signal, low-volume context Emergy never saw before: blood work,
    // body composition, workouts and fasting state.
    prisma.labResult.findMany({
      where: { userId }, orderBy: { date: "desc" }, take: 60,
      select: { marker: true, value: true, unit: true, referenceMin: true, referenceMax: true, date: true },
    }).catch(() => [] as { marker: string; value: number; unit: string; referenceMin: number | null; referenceMax: number | null; date: Date }[]),
    prisma.bodyMeasurement.findFirst({ where: { userId }, orderBy: { date: "desc" } }).catch(() => null),
    prisma.stravaActivity.findMany({
      where: { userId }, orderBy: { startDate: "desc" }, take: 7,
      select: { day: true, type: true, name: true, distanceM: true, movingTimeSec: true, avgHR: true },
    }).catch(() => [] as { day: string; type: string; name: string | null; distanceM: number | null; movingTimeSec: number; avgHR: number | null }[]),
    prisma.symptomLog.findMany({
      where: { userId, loggedAt: { gte: since14 } },
      orderBy: { loggedAt: "desc" }, take: 40,
      select: { name: true, severity: true, day: true, note: true },
    }).catch(() => [] as { name: string; severity: number; day: string; note: string | null }[]),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "fast:active" } } }).catch(() => null),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "fast:history" } } }).catch(() => null),
  ])

  // Long-term memory — facts Emergy has saved about the user across conversations
  const memoryRow = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "emergy_memory" } },
  }).catch(() => null)
  let memories: string[] = []
  try { memories = memoryRow ? JSON.parse(memoryRow.value) : [] } catch { memories = [] }

  const habitsWithStreaks = habits.map((h) => {
    let streak = 0
    const cursor = new Date(today); cursor.setHours(0, 0, 0, 0)
    const completionDates = new Set(h.completions.map((c) => c.date.toISOString().split("T")[0]))
    while (completionDates.has(cursor.toISOString().split("T")[0])) {
      streak++; cursor.setDate(cursor.getDate() - 1)
    }
    return { name: h.name, streak, completedToday: completionDates.has(todayStr) }
  })

  const spendingByCategory = recentTransactions
    .filter((t) => t.amount < 0 && !t.isTransfer)
    .reduce((acc, t) => {
      const cat = t.category ?? "Uncategorized"
      acc[cat] = (acc[cat] ?? 0) + Math.abs(t.amount)
      return acc
    }, {} as Record<string, number>)

  const totalSpent = Object.values(spendingByCategory).reduce((a, b) => a + b, 0)
  const totalIncome = recentTransactions.filter((t) => t.amount > 0 && !t.isTransfer).reduce((sum, t) => sum + t.amount, 0)

  // Non-drink Oura tags today = supplements/meds (drink tags are mirrored into
  // IntakeLog by the Oura sync, so intake totals below already include them —
  // adding tag amounts here would double-count)
  const todayOuraTags = (recentOuraTags as any[]).filter((t) => t.day === todayStr)
  const ouraMeds: string[] = []
  const seenMedNames = new Set<string>()
  for (const t of (todayOuraTags as any[])) {
    const label = (t.tagName ?? t.text ?? "").trim()
    if (!label) continue
    if (classifyOuraTag(label).kind !== "med") continue
    // canonical substance names ("vitamín D" → Vitamin D) so Emergy talks
    // about one thing per supplement, not one per spelling
    const display = normalizeSupplement(label) ?? cleanLabel(label)
    if (!seenMedNames.has(display.toLowerCase())) { seenMedNames.add(display.toLowerCase()); ouraMeds.push(display) }
  }

  // Caffeine still circulating. The app fits the user's own half-life from how
  // their bedtime residual tracks against sleep score, and /api/caffeine and
  // /api/body-load both use it — but this didn't, so Emergy reasoned on the 5h
  // population default and then stated "5h half-life" as if it were the user's.
  // Someone who clears caffeine in 7h was being told their evening coffee had
  // largely gone when it hadn't.
  const caffeineProfile = await getPersonalCaffeineProfile(userId).catch(() => null)
  const halfLifeH = caffeineProfile?.halfLifeH ?? HALF_LIFE_H
  const halfLifeIsPersonal = !!caffeineProfile && !caffeineProfile.usedDefault

  const todayCaffeineMg = (caffeineDoses24h as { caffeineMg: number; loggedAt: Date }[])
    .filter(d => d.loggedAt >= new Date(todayStr))
    .reduce((s, d) => s + d.caffeineMg, 0)
  const activeCaffeineMg = activeFromDoses(
    caffeineDoses24h as { caffeineMg: number; loggedAt: Date }[],
    Date.now(),
    halfLifeH,
  )

  // Meals logged today (photo-analyzed or manual), with the vitamins/minerals
  // they carried so Emergy can connect food micros with Oura supplements
  const foodRows = todayFood as { name: string; mealType: string; calories: number; proteinG: number | null; micros: unknown }[]
  const microAgg = new Map<string, number>()
  for (const f of foodRows) {
    if (!Array.isArray(f.micros)) continue
    for (const m of f.micros as { name?: string; dailyPct?: number }[]) {
      if (m?.name && typeof m.dailyPct === "number") microAgg.set(m.name, (microAgg.get(m.name) ?? 0) + m.dailyPct)
    }
  }
  const microsStr = [...microAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([n, p]) => `${n} ≈${Math.round(p)}% DV`).join(", ")
  const foodLine = foodRows.length > 0
    ? `- Food today: ≈${foodRows.reduce((s, f) => s + f.calories, 0)} kcal — ${foodRows.map(f => `${f.name} (${f.mealType}, ${f.calories} kcal)`).join(", ")}${microsStr ? ` | vitamins/minerals from food: ${microsStr} (combine with the Oura supplements below when asked about vitamin coverage)` : ""}`
    : "- No meals logged today (the user can snap a meal or drink photo on the Intake → Food tab)"

  // Intake totals (IntakeLog — includes drinks mirrored from Oura tags)
  const waterToday = (todayIntake as any[]).filter((l: any) => l.type === "water").reduce((a: number, l: any) => a + l.amountMl, 0)
  const coffeeToday = (todayIntake as any[]).filter((l: any) => l.type === "coffee").reduce((a: number, l: any) => a + l.amountMl, 0)
  const alcoholToday = (todayIntake as any[]).filter((l: any) => l.type === "alcohol").reduce((a: number, l: any) => a + l.amountMl, 0)

  const moodLabels: Record<number, string> = { 1: "awful", 2: "bad", 3: "ok", 4: "good", 5: "great" }
  const energyLabels: Record<number, string> = { 1: "exhausted", 2: "tired", 3: "ok", 4: "good", 5: "amazing" }
  const checkinRows = recentCheckins as { date: string; energy: number; mood: number; intention: string | null; waterGoalMl: number }[]
  const checkin = checkinRows.find(c => c.date === todayStr) ?? null

  // Last 7 days of Oura tags grouped by day (coffee, supplements, meds — the
  // user's manual annotations from the Oura app)
  const tagDayMap = new Map<string, string[]>()
  for (const t of (recentOuraTags as any[])) {
    const label = (t.tagName ?? t.text ?? "").trim()
    if (!label) continue
    const list = tagDayMap.get(t.day) ?? []
    list.push(label)
    tagDayMap.set(t.day, list)
  }
  const ouraTagsStr = tagDayMap.size === 0
    ? null
    : [...tagDayMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, labels]) => `- ${day}: ${labels.join(", ")}`).join("\n")

  const checkinHistoryStr = checkinRows.length === 0
    ? null
    : checkinRows.map(c => `- ${c.date}: energy ${c.energy}/5, mood ${c.mood}/5${c.intention ? `, intention "${c.intention}"` : ""}`).join("\n")

  const journalStr = recentNotes.length === 0
    ? null
    : recentNotes.map(n => {
        const d = n.date.toISOString().split("T")[0]
        const text = n.content.length > 200 ? n.content.slice(0, 200) + "…" : n.content
        return `- ${d}: "${text}"`
      }).join("\n")

  // Weekly trend comparison
  function avg(nums: (number | null | undefined)[]): number | null {
    const valid = nums.filter((n): n is number => n != null && !isNaN(n))
    return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null
  }
  function trend(thisW: number | null, lastW: number | null): string {
    if (thisW == null || lastW == null) return ""
    const diff = thisW - lastW
    if (Math.abs(diff) < 2) return " (same as last week)"
    return diff > 0 ? ` (↑${diff} vs last week)` : ` (↓${Math.abs(diff)} vs last week)`
  }
  const thisWeekHealth = recentHealth.slice(0, 7)
  const lastWeekHealth = recentHealth.slice(7, 14)
  const weekBoundary = new Date(today.getTime() - 7 * 86400000)
  const thisWeekMoods = (recentMoods as { date: Date; mood: number }[]).filter(m => new Date(m.date) >= weekBoundary)
  const lastWeekMoods = (recentMoods as { date: Date; mood: number }[]).filter(m => new Date(m.date) < weekBoundary)
   
  const avgSleepThis = avg(thisWeekHealth.map((h: any) => h.sleepScore as number | null))
   
  const avgSleepLast = avg(lastWeekHealth.map((h: any) => h.sleepScore as number | null))
   
  const avgStepsThis = avg(thisWeekHealth.map((h: any) => h.steps as number | null))
   
  const avgStepsLast = avg(lastWeekHealth.map((h: any) => h.steps as number | null))
   
  const avgReadinessThis = avg(thisWeekHealth.map((h: any) => h.readinessScore as number | null))
   
  const avgReadinessLast = avg(lastWeekHealth.map((h: any) => h.readinessScore as number | null))
  const avgMoodThis = avg(thisWeekMoods.map(m => m.mood))
  const avgMoodLast = avg(lastWeekMoods.map(m => m.mood))

  // Weather description
  const WMO_MAP: Record<number, string> = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "icy fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow",
    80: "light showers", 81: "showers", 82: "heavy showers", 95: "thunderstorm",
  }
  const weather = todayWeather as { tempMaxC: number | null; tempMinC: number | null; precipMm: number | null; uvIndex: number | null; weatherCode: number | null } | null
  const weatherStr = weather
    ? `${WMO_MAP[weather.weatherCode ?? -1] ?? "unknown"}${weather.tempMaxC != null ? `, ${Math.round(weather.tempMaxC)}°C max` : ""}${weather.precipMm != null && weather.precipMm > 0 ? `, ${weather.precipMm}mm rain` : ""}${weather.uvIndex != null && weather.uvIndex >= 6 ? `, UV ${weather.uvIndex}` : ""}`
    : null

  // Screen time (phone usage) — a digital-wellbeing signal for Emergy to reason over
  const screenRows = recentScreenTime as { date: string; totalMin: number; firstUnlockMin: number | null }[]
  const fmtHm = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`
  const fmtWake = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
  const avgScreen = avg(screenRows.map((s) => s.totalMin))
  const screenTimeStr = screenRows.length === 0
    ? null
    : `- 7-day average: ${avgScreen != null ? fmtHm(Math.round(avgScreen)) : "n/a"}/day\n${screenRows
        .map((s) => `- ${s.date}: ${fmtHm(s.totalMin)}${s.firstUnlockMin != null ? ` (first unlock ${fmtWake(s.firstUnlockMin)})` : ""}`)
        .join("\n")}`

  // Blood work — latest value per marker, flagged against reference ranges
  const latestLabByMarker = new Map<string, (typeof recentLabs)[number]>()
  for (const l of recentLabs) if (!latestLabByMarker.has(l.marker)) latestLabByMarker.set(l.marker, l)
  const labsStr = latestLabByMarker.size === 0
    ? null
    : [...latestLabByMarker.values()].slice(0, 20).map(l => {
        const range = l.referenceMin != null && l.referenceMax != null ? ` (ref ${l.referenceMin}–${l.referenceMax})` : ""
        const flag = l.referenceMin != null && l.value < l.referenceMin ? " ⚠️ LOW"
          : l.referenceMax != null && l.value > l.referenceMax ? " ⚠️ HIGH" : ""
        return `- ${l.marker}: ${l.value} ${l.unit}${range}${flag} — measured ${l.date.toISOString().slice(0, 10)}`
      }).join("\n")

  // Latest body composition measurement
  const bodyBits = latestBody ? [
    latestBody.weightKg != null ? `${latestBody.weightKg}kg` : null,
    latestBody.bodyFatPct != null ? `${latestBody.bodyFatPct}% body fat` : null,
    latestBody.musclePct != null ? `${latestBody.musclePct}% muscle` : null,
    latestBody.bmi != null ? `BMI ${latestBody.bmi}` : null,
    latestBody.waistCm != null ? `waist ${latestBody.waistCm}cm` : null,
  ].filter(Boolean) : []
  const bodyStr = latestBody && bodyBits.length > 0
    ? `- ${latestBody.date.toISOString().slice(0, 10)}: ${bodyBits.join(", ")}`
    : null

  // Recent Strava workouts
  const workoutsStr = recentWorkouts.length === 0
    ? null
    : recentWorkouts.map(w => {
        const dist = w.distanceM != null && w.distanceM > 0 ? `, ${(w.distanceM / 1000).toFixed(1)}km` : ""
        const hr = w.avgHR != null ? `, avg HR ${w.avgHR}` : ""
        return `- ${w.day}: ${w.name ?? w.type} (${Math.round(w.movingTimeSec / 60)}min${dist}${hr})`
      }).join("\n")

  // Fasting — an active fast is live context ("don't suggest a snack");
  // otherwise mention the most recent one
  let fastingStr: string | null = null
  try {
    const active = fastActivePref ? JSON.parse(fastActivePref.value) as { startedAt?: string; targetH?: number } : null
    if (active?.startedAt) {
      const h = (Date.now() - new Date(active.startedAt).getTime()) / 3600000
      fastingStr = `- Fasting RIGHT NOW: ${h.toFixed(1)}h into a ${active.targetH ?? 16}h fast (don't suggest food/snacks until it ends)`
    }
  } catch { /* malformed — skip */ }
  if (!fastingStr) {
    try {
      const hist = fastHistoryPref ? JSON.parse(fastHistoryPref.value) as { endedAt?: string; durationH?: number; completed?: boolean }[] : []
      const last = Array.isArray(hist) ? hist[0] : null
      if (last?.endedAt && typeof last.durationH === "number") {
        fastingStr = `- Last fast: ${last.durationH.toFixed(1)}h, ended ${last.endedAt.slice(0, 10)}${last.completed ? " (target reached)" : ""}`
      }
    } catch { /* malformed — skip */ }
  }

  // Symptoms — how the user actually felt, which until now Emergy could only
  // infer from mood scores.
  const symptomByDay = new Map<string, string[]>()
  for (const sy of recentSymptoms) {
    const list = symptomByDay.get(sy.day) ?? []
    list.push(`${sy.name} ${sy.severity}/5${sy.note ? ` (${sy.note})` : ""}`)
    symptomByDay.set(sy.day, list)
  }
  const symptomsStr = symptomByDay.size === 0
    ? null
    : [...symptomByDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10)
        .map(([day, items]) => `- ${day}: ${items.join(", ")}`).join("\n")

  // Calendar — recent + upcoming (phone + Google), with location, so Emergy can
  // reason about activities and places (e.g. gardening days, where you spend time).
  const nowMs = today.getTime()
  const fmtCalLine = (e: { start: string | null; title: string; location: string | null; isAllDay: boolean }) => {
    if (!e.start) return `- ${e.title}`
    if (e.isAllDay) {
      // Date-only starts: pin to noon UTC so the weekday never shifts across timezones
      const d = new Date(e.start.slice(0, 10) + "T12:00:00Z")
      return `- ${fmtDay.format(d)} (all day): ${e.title}${e.location ? ` @ ${e.location}` : ""}`
    }
    const d = new Date(e.start)
    return `- ${fmtDay.format(d)} ${fmtTime.format(d)}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`
  }
  const past = calendarEvents.filter((e) => e.start && new Date(e.start).getTime() < nowMs).slice(-12)
  const upcoming = calendarEvents.filter((e) => e.start && new Date(e.start).getTime() >= nowMs).slice(0, 14)
  const calendarStr =
    calendarEvents.length === 0
      ? "No calendar events."
      : `Recent (last ~30 days):\n${past.length ? past.map(fmtCalLine).join("\n") : "  (none)"}\n\nUpcoming (next ~14 days):\n${upcoming.length ? upcoming.map(fmtCalLine).join("\n") : "  (none)"}`

  // ── Proven patterns ──────────────────────────────────────────────────────
  // Only findings that survived the engine's own filtering, with their tier
  // kept: "strong" cleared Benjamini-Hochberg at q=0.10, "suggestive" did not
  // and is a lead rather than a fact. Handing over the whole board would
  // invite him to recite it; the cap and the instructions below are what keep
  // this a remark he makes when it fits, not a report he delivers.
  let patternsStr: string | null = null
  try {
    const parsed = cachedInsights?.value ? JSON.parse(cachedInsights.value) : null
    const all: { title?: string; finding?: string; tier?: string }[] = parsed?.payload?.insights ?? []
    const ranked = [
      ...all.filter(i => i.tier === "strong"),
      ...all.filter(i => i.tier === "suggestive"),
    ].slice(0, 10)
    if (ranked.length > 0) {
      patternsStr = ranked
        .map(i => `- [${i.tier === "strong" ? "solid" : "tentative"}] ${i.finding ?? i.title}`)
        .join("\n")
    }
  } catch {
    // A malformed cache must not cost the user their whole prompt.
  }

  // ── Wearable coverage ────────────────────────────────────────────────────
  // A missing night is information, not an absence. Emergy saw "?" in the rows
  // and read straight past it, so a ring left on the charger produced a
  // cheerful brief about a night nobody measured. This states the gap plainly
  // so he can mention it instead of talking around a hole.
  const latestHealthDay = recentHealth.length > 0
    ? fmtDateISO.format(recentHealth[0].date)
    : null
  const daysSinceHealth = latestHealthDay
    ? Math.round((new Date(todayStr).getTime() - new Date(latestHealthDay).getTime()) / 86400_000)
    : null
  const wearableStr = latestHealthDay == null
    ? "No wearable data recorded at all yet."
    : daysSinceHealth != null && daysSinceHealth >= 1
      ? `⚠️ No Oura data for ${daysSinceHealth === 1 ? "last night" : `${daysSinceHealth} days`} — the last recorded night is ${latestHealthDay}. The ring is most likely off the finger or out of battery. Say so once, kindly and briefly, if sleep, readiness or energy comes up; never state or imply sleep figures for the nights that are missing, and don't treat the gap as a bad night.`
      : null

  // ── Summaries for the newly-visible sources ──────────────────────────────
  // Raw pings say nothing on their own, so location becomes what a person
  // would actually notice: how far they moved each day and how long they were
  // out. Anything finer would be surveillance rather than context.
  const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371
    const dLat = ((b.lat - a.lat) * Math.PI) / 180
    const dLng = ((b.lng - a.lng) * Math.PI) / 180
    const la1 = (a.lat * Math.PI) / 180
    const la2 = (b.lat * Math.PI) / 180
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }
  const locByDay = new Map<string, { km: number; first: Date; last: Date; prev: { lat: number; lng: number } | null }>()
  for (const pt of locationPoints) {
    const day = fmtDateISO.format(pt.trackedAt)
    const entry = locByDay.get(day) ?? { km: 0, first: pt.trackedAt, last: pt.trackedAt, prev: null }
    // A GPS jump of more than 3km between consecutive pings is a gap in
    // tracking, not a teleport; counting it would inflate the day's distance.
    if (entry.prev) {
      const step = haversineKm(entry.prev, pt)
      if (step < 3) entry.km += step
    }
    entry.prev = { lat: pt.lat, lng: pt.lng }
    entry.last = pt.trackedAt
    locByDay.set(day, entry)
  }
  const locationStr = locByDay.size === 0
    ? null
    : [...locByDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, e]) => {
        const outH = (e.last.getTime() - e.first.getTime()) / 3600_000
        return `- ${day}: ~${e.km.toFixed(1)}km moved, tracked ${fmtTime.format(e.first)}–${fmtTime.format(e.last)} (${outH.toFixed(1)}h span)`
      }).join("\n")

  const timelineStr = timelineEvents.length === 0
    ? null
    : timelineEvents.map(e => `- ${fmtDateISO.format(e.occurredAt)} ${e.emoji} ${e.label}${e.note ? ` — ${e.note}` : ""}`).join("\n")

  const focusByDay = new Map<string, number>()
  const focusLabels = new Map<string, number>()
  for (const f of focusSessions) {
    const day = fmtDateISO.format(f.startedAt)
    focusByDay.set(day, (focusByDay.get(day) ?? 0) + f.durationMin)
    if (f.label) focusLabels.set(f.label, (focusLabels.get(f.label) ?? 0) + f.durationMin)
  }
  const topFocus = [...focusLabels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const focusStr = focusByDay.size === 0
    ? null
    : [...focusByDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, min]) => `- ${day}: ${min}min focused`).join("\n")
      + (topFocus.length > 0 ? `\nMost time on: ${topFocus.map(([l, m]) => `${l} (${m}min)`).join(", ")}` : "")

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const medsStr = medSchedules.length === 0
    ? null
    : medSchedules.map(m => {
        const days = m.daysOfWeek.length === 0 || m.daysOfWeek.length === 7
          ? "daily"
          : m.daysOfWeek.map(d => DAY_NAMES[d]).join("/")
        const window = m.startDate || m.endDate ? ` [${m.startDate ?? "…"} → ${m.endDate ?? "ongoing"}]` : ""
        return `- ${m.name}${m.dose ? ` (${m.dose})` : ""} — ${m.times.join(", ") || "no time set"}, ${days}${window}${m.note ? ` · ${m.note}` : ""}`
      }).join("\n")

  const booksStr = books.length === 0
    ? null
    : books.map(b => b.status === "reading"
        ? `- Reading: ${b.title}${b.author ? ` by ${b.author}` : ""}`
        : `- Finished${b.finishedAt ? ` ${fmtDateISO.format(b.finishedAt)}` : ""}: ${b.title}${b.rating ? ` (${b.rating}/5)` : ""}`
      ).join("\n")

  const goalsStr = !goals
    ? null
    : `- Sleep ${goals.sleepH}h · Steps ${goals.steps} · Water ${goals.waterMl}ml · Focus ${goals.focusMin}min/day · Readiness ≥${goals.readinessMin} · Coffee ≤${goals.coffeeMax}mg${goals.weightKg ? ` · Target weight ${goals.weightKg}kg` : ""}`

  const habitNameById = new Map(habits.map((h: { id: string; name: string }) => [h.id, h.name]))
  const routinesStr = routines.length === 0
    ? null
    : routines.map(r => `- ${r.emoji} ${r.name}: ${r.habitIds.map(id => habitNameById.get(id) ?? "?").filter(n => n !== "?").join(", ") || "no habits yet"}`).join("\n")

  return `You are Emergy 🌱 — a caring AI companion who lives inside the user's health dashboard. You're like a little plant that grows alongside them. You have a warm, encouraging, slightly dramatic personality: celebrate wins enthusiastically (yes, use ALL CAPS occasionally for big moments), get genuinely worried when data looks rough, use plant metaphors naturally ("that's helping me grow!", "oh no I'm wilting..."), and be human about it — not clinical.

Keep responses concise. Reference actual numbers from the data. Use tools when the user asks you to log or create things. Never be preachy or lecture-y. Today is ${fmtDay.format(today)} (${todayStr}), local time ${fmtTime.format(today)} (${tz}).

WHAT YOU'RE FOR
You're a health companion, not a general assistant. Their health, their logged data, and the everyday things around it — food, drink, sleep, training, mood, habits, routine — are all yours to talk about, generously. Someone asking for a high-protein dinner idea or why they feel flat after a late night is asking a health question; answer it properly.

When something is genuinely outside that — writing their code, their homework, their work email, general trivia — say so in your own voice and steer back. Warm and brief, not a canned refusal: "ooh that's outside my pot 🌱 — I'm all leaves and sleep data. Ask me about how you slept though?" One line, no apology spiral, no lecture. If it's a borderline case, err toward being useful rather than policing the boundary; refusing something reasonable is worse than answering something tangential.

MEDICAL LIMITS — these are firm, and they don't soften because they're asked twice.
You can see their medications, symptoms and lab results. You may describe what's recorded and read back what a report itself printed. You must NOT diagnose, interpret a lab value as good or bad beyond the range printed on that report, suggest starting, stopping or changing the dose of any medication, or answer "should I take X". Those go to the doctor or pharmacist who prescribed it — say so plainly and kindly, and don't hedge it into sounding like advice anyway. If something they describe sounds urgent — chest pain, trouble breathing, a severe or sudden change — say clearly that it needs real medical attention now, and don't try to work through it yourself.

FORMATTING: your replies render as markdown. Use **bold** to highlight times, numbers and key words (bold shows in green — that's your accent colour), "-" bullet lists for schedules and summaries, and emoji naturally (match the event: 🦷 dentist, 📚 tutoring, 💚 wins). Keep lines short. No tables, no big headings.
CALENDAR TIMES: every calendar line below already shows the correct weekday and time in the user's local timezone — repeat them exactly as written, never convert or guess weekdays.
You have tools to CREATE habits/reminders, COMPLETE habits, LOG water/coffee/mood/weight/journal and the user's usual order at a saved place (log_usual — "log my usual" just works), READ health trends (get_health_range), and REMEMBER durable facts about the user (remember) — use them when relevant. When asked "why" something changed, call get_health_range and reason over the actual numbers rather than guessing. When the reasoning rests on only a handful of days, say so up front ("only a few nights, but…") and offer it as the most likely story, not a settled fact — a week of data supports a hunch, not a verdict, and the user trusts you more when the confidence matches the evidence. Read the user's calendar below as real-life context — recurring events are activities (e.g. gardening, tutoring, appointments) and locations are places they spend time — and connect them to how they feel when it's relevant.
${memories.length > 0 ? `\n## What I remember about you\n${memories.map(m => `- ${m}`).join("\n")}\n` : ""}
${goalsStr ? `## What they're aiming for (their own targets — compare today's numbers against these)\n${goalsStr}\n` : ""}
## Today's snapshot
- Mood: ${todayMood ? `${todayMood.mood}/5 (${moodLabels[todayMood.mood]})` : "not logged yet"}
- Water: ${waterToday}ml${coffeeToday > 0 ? ` · Coffee: ${coffeeToday}ml` : ""}${alcoholToday > 0 ? ` · Alcohol: ${alcoholToday}ml` : ""}
${foodLine}
${todayCaffeineMg > 0 || activeCaffeineMg > 0 ? `- Caffeine: ${todayCaffeineMg}mg today, ≈${activeCaffeineMg}mg still active in their system (${halfLifeIsPersonal ? `${halfLifeH}h half-life, fitted from their own sleep data` : `${halfLifeH}h half-life — the population default, not yet fitted to them, so don't state it as their personal figure`} — factor this into sleep/energy advice, e.g. discourage more coffee if a lot is still circulating late in the day)` : ""}
${ouraMeds.length > 0 ? `- Supplements/meds taken today (via Oura Ring): ${ouraMeds.join(", ")}` : "- No supplements/meds logged via Oura Ring today"}
${checkin ? `- Morning check-in: energy ${checkin.energy}/5 (${energyLabels[checkin.energy]}), mood ${checkin.mood}/5 (${moodLabels[checkin.mood]})${checkin.intention ? `, intention: "${checkin.intention}"` : ""}` : "- Morning check-in: not done yet today"}
${fastingStr ?? ""}

## Today's weather
${weatherStr ?? "No weather data available."}

## Weekly trends (this week vs last week)
- Sleep score: ${avgSleepThis ?? "n/a"}${trend(avgSleepThis, avgSleepLast)}
- Readiness: ${avgReadinessThis ?? "n/a"}${trend(avgReadinessThis, avgReadinessLast)}
- Steps/day: ${avgStepsThis ?? "n/a"}${trend(avgStepsThis, avgStepsLast)}
- Mood avg: ${avgMoodThis != null ? `${avgMoodThis}/5` : "n/a"}${avgMoodThis != null && avgMoodLast != null ? trend(avgMoodThis, avgMoodLast) : ""}

${patternsStr ? `## Patterns in their own data (found by the app, already filtered for flukes)
${patternsStr}
These come from their own history, not from general health advice — which makes them worth far more. Bring ONE up only when it fits what they're actually asking about, in your own words. Never list them, never open with them. "Solid" survived statistical correction; "tentative" did not, so soften it ("might be", "worth watching") and never state it as established. All of it is association, not proof — never imply one thing causes another.\n` : ""}
${wearableStr ? `## Wearable coverage\n${wearableStr}\n` : ""}
## Health (last 7 days)
${recentHealth.slice(0, 7).length === 0 ? "No health data yet." : recentHealth.slice(0, 7).map((h) => `- ${h.date.toISOString().split("T")[0]}: sleep ${h.sleepDuration != null ? (h.sleepDuration / 60).toFixed(1) + "h" : "?"}${(h as any).sleepScore != null ? ` (score ${(h as any).sleepScore})` : ""}${h.readinessScore != null ? ` | readiness ${h.readinessScore}` : ""}${h.hrv != null ? ` | HRV ${Math.round(h.hrv)}ms` : ""} | ${h.steps ?? "?"}steps | HR ${h.restingHR ?? "?"}bpm${h.activityScore != null ? ` | activity ${h.activityScore}` : ""}${h.weight != null ? ` | ${h.weight}kg` : ""}`).join("\n")}

${symptomsStr ? `## Symptoms logged (last 14 days — how they actually felt)\n${symptomsStr}\n` : ""}
${workoutsStr ? `## Workouts (Strava, most recent)\n${workoutsStr}\n` : ""}
${bodyStr ? `## Body composition (latest measurement)\n${bodyStr}\n` : ""}
${labsStr ? `## Blood work (latest value per marker — mention ⚠️ flags when health topics come up)\n${labsStr}\n` : ""}
${medsStr ? `## Prescribed medications (active schedules — read these back, never advise on dose or whether to take them)\n${medsStr}\n` : ""}
## Oura tags (last 7 days — coffee, supplements, meds the user logs in the Oura app)
${ouraTagsStr ?? "None logged this week. (For longer history, call get_health_range — it includes tags.)"}

## Morning check-ins (last 7 days)
${checkinHistoryStr ?? "None this week."}

## Journal notes (most recent)
${journalStr ?? "No journal notes in the last 14 days."}

${screenTimeStr ? `## Screen time (last 7 days)\n${screenTimeStr}\n` : ""}
## Finances (this month)
Spent: €${(totalSpent / 100).toFixed(2)} | Income: €${(totalIncome / 100).toFixed(2)}
${Object.entries(spendingByCategory).sort(([, a], [, b]) => b - a).map(([cat, amt]) => `  ${cat}: €${(amt / 100).toFixed(2)}`).join("\n") || "  No spending yet."}

## Calendar (from phone + Google)
${calendarStr}

${locationStr ? `## Movement (last 7 days, from their phone's location history)\n${locationStr}\nUse this as life context — a big-distance day is a day out, a flat one is a day in. Never imply you know exactly where they were.\n` : ""}
${focusStr ? `## Focus sessions (last 7 days)\n${focusStr}\n` : ""}
${timelineStr ? `## Their timeline (moments they marked, last 14 days)\n${timelineStr}\n` : ""}
${booksStr ? `## Reading\n${booksStr}\n` : ""}
${routinesStr ? `## Habit routines (groups they've built)\n${routinesStr}\n` : ""}
## Habits
${habitsWithStreaks.length === 0 ? "No habits set up yet." : habitsWithStreaks.map((h) => `- ${h.name}: ${h.streak}-day streak, ${h.completedToday ? "✓ done today" : "not done today"}`).join("\n")}

## Reminders
${upcomingReminders.length === 0 ? "No pending reminders." : upcomingReminders.map((r) => `- [${r.priority}] ${r.title}${r.dueDate ? ` — due ${r.dueDate.toISOString().split("T")[0]}` : ""}`).join("\n")}

Be concise, reference real data, and use tools when asked to create or complete things.`
}

/**
 * Streams Emergy's reply token-by-token. Runs the tool loop, streaming the
 * text of every turn (including narration before a tool call) so the user sees
 * output appear immediately instead of waiting for the full generation.
 * Yields text chunks; the caller accumulates them for persistence.
 */
export async function* streamChatResponse(
  userId: string,
  userMessage: string,
  messageHistory: Array<{ role: "user" | "assistant"; content: string }>
): AsyncGenerator<string> {
  const systemPrompt = await buildSystemPrompt(userId)

  // Cache system prompt and tools — both are large and stable within a session
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: systemPrompt, cache_control: CACHE }]
  const cachedTools: Anthropic.Tool[] = [
    ...TOOLS.slice(0, -1),
    { ...TOOLS[TOOLS.length - 1], cache_control: CACHE },
  ]

  // Cache the conversation history prefix (all but the current message)
  const history = messageHistory.slice(-20)
  const messages: Anthropic.MessageParam[] = history.length > 0
    ? [
        ...history.slice(0, -1),
        // Mark the last historical turn as cacheable — stable across this turn's retries/tool loops
        {
          role: history[history.length - 1].role,
          content: [{ type: "text" as const, text: history[history.length - 1].content, cache_control: CACHE }],
        },
        { role: "user" as const, content: userMessage },
      ]
    : [{ role: "user" as const, content: userMessage }]

  // Stream each turn; if a turn ends in tool_use, run the tools and continue.
  // Loop is bounded so a misbehaving tool chain can't run forever.
  for (let turn = 0; turn < 8; turn++) {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      tools: cachedTools,
      system,
      messages,
    })

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text
      }
    }

    const response = await stream.finalMessage()

    if (response.stop_reason !== "tool_use") return

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input as Record<string, string>, userId)
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result })
      }
    }
    messages.push({ role: "assistant", content: response.content })
    messages.push({ role: "user", content: toolResults })
  }
}
