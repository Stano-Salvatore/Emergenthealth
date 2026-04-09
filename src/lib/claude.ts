import Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/prisma"
import { getUpcomingEvents } from "@/lib/google-calendar"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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

  return "Unknown tool."
}

async function buildSystemPrompt(userId: string): Promise<string> {
  const today = new Date()
  const todayStr = today.toISOString().split("T")[0]
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const [recentHealth, recentTransactions, habits, upcomingReminders, calendarEvents] =
    await Promise.all([
      prisma.healthLog.findMany({
        where: { userId }, orderBy: { date: "desc" }, take: 7,
        select: { id: true, date: true, sleepDuration: true, deepSleep: true, remSleep: true, steps: true, restingHR: true, weight: true, activeMinutes: true, caloriesBurned: true },
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

  return `You are the personal AI assistant embedded in the user's health and life dashboard. Today is ${todayStr}.
You have tools to CREATE habits and reminders, and COMPLETE habits — use them when the user asks.

## Health (last 7 days)
${recentHealth.length === 0 ? "No health data yet." : recentHealth.map((h) => `- ${h.date.toISOString().split("T")[0]}: ${h.steps ?? "?"}steps | sleep ${h.sleepDuration != null ? (h.sleepDuration / 60).toFixed(1) + "h" : "?"} (deep:${h.deepSleep ?? "?"}min REM:${h.remSleep ?? "?"}min) | weight:${(h as { weight?: number | null }).weight ?? "?"}kg | HR:${h.restingHR ?? "?"}bpm`).join("\n")}

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
  const messages: Anthropic.MessageParam[] = [
    ...messageHistory.slice(-20),
    { role: "user", content: userMessage },
  ]

  // Non-streaming call with tools
  let response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2048,
    tools: TOOLS,
    system: systemPrompt,
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
      model: "claude-opus-4-6",
      max_tokens: 2048,
      tools: TOOLS,
      system: systemPrompt,
      messages,
    })
  }

  // Stream the final text response
  const textBlock = response.content.find((b) => b.type === "text")
  const finalText = textBlock?.type === "text" ? textBlock.text : ""

  // Return as async iterable that mimics the streaming API shape
  return finalText
}
