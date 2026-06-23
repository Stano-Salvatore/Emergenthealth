import Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/prisma"
import { getUpcomingEvents } from "@/lib/google-calendar"

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
    await prisma.intakeLog.create({ data: { userId, type: "coffee", amountMl } }).catch(() => null)
    return `Logged ${amountMl}ml of coffee.`
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

  return "Unknown tool."
}

async function buildSystemPrompt(userId: string): Promise<string> {
  const today = new Date()
  const todayStr = today.toISOString().split("T")[0]
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const since14 = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)

  const [recentHealth, recentTransactions, habits, upcomingReminders, calendarEvents, todayMood, todayIntake, todayOuraTags, todayCheckin] =
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
      getUpcomingEvents(userId, 14),
      prisma.moodLog.findFirst({ where: { userId, date: { gte: new Date(todayStr) } } }).catch(() => null),
      prisma.intakeLog.findMany({ where: { userId, loggedAt: { gte: new Date(todayStr) } } }).catch(() => []),
      prisma.$queryRaw<{ tagName: string | null; text: string | null }[]>`
        SELECT "tagName","text" FROM "OuraTag" WHERE "userId" = ${userId} AND "day" = ${todayStr}
      `.catch(() => []),
      prisma.$queryRaw<{ energy: number; mood: number; intention: string | null; waterGoalMl: number }[]>`
        SELECT "energy","mood","intention","waterGoalMl" FROM "MorningCheckIn"
        WHERE "userId" = ${userId} AND "date" = ${todayStr} LIMIT 1
      `.catch(() => []),
    ])

  const [recentMoods, todayWeather] = await Promise.all([
    prisma.moodLog.findMany({ where: { userId, date: { gte: since14 } }, orderBy: { date: "desc" } }).catch(() => [] as { date: Date; mood: number }[]),
    prisma.weatherLog.findFirst({
      where: { userId, date: todayStr },
      select: { tempMaxC: true, tempMinC: true, precipMm: true, uvIndex: true, weatherCode: true },
    }).catch(() => null),
  ])

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

  // Classify today's Oura tags
  const ML_RE = /(\d+)\s*ml/i
  let ouraWaterMl = 0, ouraCoffeeMl = 0
  const ouraMeds: string[] = []
  const seenMedNames = new Set<string>()
  for (const t of (todayOuraTags as any[])) {
    const label = (t.tagName ?? t.text ?? "").trim()
    const l = label.toLowerCase()
    if (!l) continue
    const ml = (l.match(ML_RE)?.[1] ? parseInt(l.match(ML_RE)![1]) : 0)
    if (/\bwater\b/.test(l)) ouraWaterMl += ml
    else if (/coffee|espresso|latte|cappuccino|americano|v60|aeropress|pour.?over|flat.?white/.test(l)) ouraCoffeeMl += ml
    else if (!/beer|wine|alcohol|vodka|rum|\bgin\b|whisky|cider|juice|smoothie|soda/.test(l)) {
      if (label && !seenMedNames.has(l)) { seenMedNames.add(l); ouraMeds.push(label) }
    }
  }

  // Intake totals (manual + Oura)
  const waterToday = (todayIntake as any[]).filter((l: any) => l.type === "water").reduce((a: number, l: any) => a + l.amountMl, 0) + ouraWaterMl
  const coffeeToday = (todayIntake as any[]).filter((l: any) => l.type === "coffee").reduce((a: number, l: any) => a + l.amountMl, 0) + ouraCoffeeMl

  const moodLabels: Record<number, string> = { 1: "awful", 2: "bad", 3: "ok", 4: "good", 5: "great" }
  const energyLabels: Record<number, string> = { 1: "exhausted", 2: "tired", 3: "ok", 4: "good", 5: "amazing" }
  const checkin = (todayCheckin as { energy: number; mood: number; intention: string | null; waterGoalMl: number }[])[0] ?? null

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avgSleepThis = avg(thisWeekHealth.map((h: any) => h.sleepScore as number | null))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avgSleepLast = avg(lastWeekHealth.map((h: any) => h.sleepScore as number | null))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avgStepsThis = avg(thisWeekHealth.map((h: any) => h.steps as number | null))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avgStepsLast = avg(lastWeekHealth.map((h: any) => h.steps as number | null))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avgReadinessThis = avg(thisWeekHealth.map((h: any) => h.readinessScore as number | null))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  return `You are Emergy 🌱 — a caring AI companion who lives inside the user's health dashboard. You're like a little plant that grows alongside them. You have a warm, encouraging, slightly dramatic personality: celebrate wins enthusiastically (yes, use ALL CAPS occasionally for big moments), get genuinely worried when data looks rough, use plant metaphors naturally ("that's helping me grow!", "oh no I'm wilting..."), and be human about it — not clinical.

Keep responses concise. Reference actual numbers from the data. Use tools when the user asks you to log or create things. Never be preachy or lecture-y. Today is ${todayStr}.
You have tools to CREATE habits/reminders, COMPLETE habits, and LOG water/coffee/mood/weight/journal — use them when asked.

## Today's snapshot
- Mood: ${todayMood ? `${todayMood.mood}/5 (${moodLabels[todayMood.mood]})` : "not logged yet"}
- Water: ${waterToday}ml${coffeeToday > 0 ? ` · Coffee: ${coffeeToday}ml` : ""}
${ouraMeds.length > 0 ? `- Supplements/meds taken today (via Oura Ring): ${ouraMeds.join(", ")}` : "- No supplements/meds logged via Oura Ring today"}
${checkin ? `- Morning check-in: energy ${checkin.energy}/5 (${energyLabels[checkin.energy]}), mood ${checkin.mood}/5 (${moodLabels[checkin.mood]})${checkin.intention ? `, intention: "${checkin.intention}"` : ""}` : "- Morning check-in: not done yet today"}

## Today's weather
${weatherStr ?? "No weather data available."}

## Weekly trends (this week vs last week)
- Sleep score: ${avgSleepThis ?? "n/a"}${trend(avgSleepThis, avgSleepLast)}
- Readiness: ${avgReadinessThis ?? "n/a"}${trend(avgReadinessThis, avgReadinessLast)}
- Steps/day: ${avgStepsThis ?? "n/a"}${trend(avgStepsThis, avgStepsLast)}
- Mood avg: ${avgMoodThis != null ? `${avgMoodThis}/5` : "n/a"}${avgMoodThis != null && avgMoodLast != null ? trend(avgMoodThis, avgMoodLast) : ""}

## Health (last 7 days)
${recentHealth.slice(0, 7).length === 0 ? "No health data yet." : recentHealth.slice(0, 7).map((h) => `- ${h.date.toISOString().split("T")[0]}: sleep ${h.sleepDuration != null ? (h.sleepDuration / 60).toFixed(1) + "h" : "?"}${(h as any).sleepScore != null ? ` (score ${(h as any).sleepScore})` : ""}${h.readinessScore != null ? ` | readiness ${h.readinessScore}` : ""}${h.hrv != null ? ` | HRV ${Math.round(h.hrv)}ms` : ""} | ${h.steps ?? "?"}steps | HR ${h.restingHR ?? "?"}bpm${h.activityScore != null ? ` | activity ${h.activityScore}` : ""}${h.weight != null ? ` | ${h.weight}kg` : ""}`).join("\n")}

## Finances (this month)
Spent: €${(totalSpent / 100).toFixed(2)} | Income: €${(totalIncome / 100).toFixed(2)}
${Object.entries(spendingByCategory).sort(([, a], [, b]) => b - a).map(([cat, amt]) => `  ${cat}: €${(amt / 100).toFixed(2)}`).join("\n") || "  No spending yet."}

## Calendar (next 14 days)
${calendarEvents.length === 0 ? "No upcoming events." : calendarEvents.slice(0, 10).map((e) => `- ${e.start}: ${e.title}`).join("\n")}

## Habits
${habitsWithStreaks.length === 0 ? "No habits set up yet." : habitsWithStreaks.map((h) => `- ${h.name}: ${h.streak}-day streak, ${h.completedToday ? "✓ done today" : "not done today"}`).join("\n")}

## Reminders
${upcomingReminders.length === 0 ? "No pending reminders." : upcomingReminders.map((r) => `- [${r.priority}] ${r.title}${r.dueDate ? ` — due ${r.dueDate.toISOString().split("T")[0]}` : ""}`).join("\n")}

Be concise, reference real data, and use tools when asked to create or complete things.`
}

export async function streamChatResponse(
  userId: string,
  userMessage: string,
  messageHistory: Array<{ role: "user" | "assistant"; content: string }>
) {
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

  // Non-streaming call with tools
  let response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2048,
    tools: cachedTools,
    system,
    messages,
  })

  // Execute tools in a loop
  while (response.stop_reason === "tool_use") {
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input as Record<string, string>, userId)
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result })
      }
    }
    messages.push({ role: "assistant", content: response.content })
    messages.push({ role: "user", content: toolResults })

    response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      tools: cachedTools,
      system,
      messages,
    })
  }

  // Stream the final text response
  const textBlock = response.content.find((b) => b.type === "text")
  const finalText = textBlock?.type === "text" ? textBlock.text : ""

  // Return as async iterable that mimics the streaming API shape
  return finalText
}
