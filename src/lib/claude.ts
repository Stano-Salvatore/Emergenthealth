import Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/prisma"
import { getUpcomingEvents } from "@/lib/google-calendar"

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

async function buildSystemPrompt(userId: string): Promise<string> {
  const today = new Date()
  const todayStr = today.toISOString().split("T")[0]
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const [recentHealth, recentTransactions, habits, upcomingReminders, calendarEvents] =
    await Promise.all([
      prisma.healthLog.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 7,
      }),
      prisma.transaction.findMany({
        where: { userId, date: { gte: monthStart } },
        orderBy: { date: "desc" },
        take: 100,
      }),
      prisma.habit.findMany({
        where: { userId, isArchived: false },
        include: {
          completions: {
            where: {
              date: {
                gte: new Date(new Date().setDate(today.getDate() - 30)),
              },
            },
            orderBy: { date: "desc" },
          },
        },
      }),
      prisma.reminder.findMany({
        where: { userId, isCompleted: false },
        orderBy: { dueDate: "asc" },
        take: 20,
      }),
      getUpcomingEvents(userId, 14),
    ])

  // Compute streaks
  const habitsWithStreaks = habits.map((h) => {
    let streak = 0
    const cursor = new Date(today)
    cursor.setHours(0, 0, 0, 0)
    const completionDates = new Set(h.completions.map((c) => c.date.toISOString().split("T")[0]))
    while (completionDates.has(cursor.toISOString().split("T")[0])) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    }
    return {
      name: h.name,
      streak,
      completedToday: completionDates.has(todayStr),
    }
  })

  // Spending summary
  const spendingByCategory = recentTransactions
    .filter((t) => t.amount < 0 && !t.isTransfer)
    .reduce(
      (acc, t) => {
        const cat = t.category ?? "Uncategorized"
        acc[cat] = (acc[cat] ?? 0) + Math.abs(t.amount)
        return acc
      },
      {} as Record<string, number>
    )

  const totalSpent = Object.values(spendingByCategory).reduce((a, b) => a + b, 0)
  const totalIncome = recentTransactions
    .filter((t) => t.amount > 0 && !t.isTransfer)
    .reduce((sum, t) => sum + t.amount, 0)

  return `You are the personal AI assistant embedded in ${userId}'s personal health and life dashboard. Today is ${todayStr}.

## Health (last 7 days)
${
  recentHealth.length === 0
    ? "No health data logged yet."
    : recentHealth
        .map(
          (h) =>
            `- ${h.date.toISOString().split("T")[0]}: ${h.steps ?? "?"}  steps | sleep ${h.sleepDuration != null ? Math.round(h.sleepDuration / 60 * 10) / 10 + "h" : "?"} (deep: ${h.deepSleep ?? "?"}min, REM: ${h.remSleep ?? "?"}min)`
        )
        .join("\n")
}

## Finances (this month)
Total spent: €${(totalSpent / 100).toFixed(2)}
Total income: €${(totalIncome / 100).toFixed(2)}
Spending by category:
${
  Object.entries(spendingByCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => `  - ${cat}: €${(amt / 100).toFixed(2)}`)
    .join("\n") || "  No spending data yet."
}

## Calendar (next 14 days)
${calendarEvents.length === 0 ? "No upcoming events." : calendarEvents.slice(0, 10).map((e) => `- ${e.start}: ${e.title}`).join("\n")}

## Habits
${habitsWithStreaks.length === 0 ? "No habits set up yet." : habitsWithStreaks.map((h) => `- ${h.name}: ${h.streak}-day streak, ${h.completedToday ? "done today ✓" : "not done today"}`).join("\n")}

## Reminders (upcoming / overdue)
${upcomingReminders.length === 0 ? "No pending reminders." : upcomingReminders.slice(0, 10).map((r) => `- [${r.priority}] ${r.title}${r.dueDate ? ` — due ${r.dueDate.toISOString().split("T")[0]}` : ""}`).join("\n")}

You have access to this live data. Be concise, specific, and reference the user's actual numbers. Give actionable insights when relevant.`
}

export async function streamChatResponse(
  userId: string,
  userMessage: string,
  messageHistory: Array<{ role: "user" | "assistant"; content: string }>
) {
  const systemPrompt = await buildSystemPrompt(userId)

  return anthropic.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      ...messageHistory.slice(-20),
      { role: "user", content: userMessage },
    ],
  })
}
