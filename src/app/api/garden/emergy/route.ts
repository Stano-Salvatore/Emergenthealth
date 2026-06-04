import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic()

interface HabitCtx {
  name: string
  streak: number
  missedDays: number
  completedToday: boolean
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { message, habits, weather, history } = await req.json() as {
    message: string
    habits: HabitCtx[]
    weather: { code: number; temp: number } | null
    history?: { role: "user" | "assistant"; content: string }[]
  }

  const thriving = habits.filter(h => h.streak >= 14).length
  const wilting  = habits.filter(h => h.missedDays >= 3).length
  const done     = habits.filter(h => h.completedToday).length

  const habitList = habits.map(h =>
    `${h.name}: streak=${h.streak}d, missed=${h.missedDays}d, today=${h.completedToday ? "✓" : "✗"}`
  ).join(" | ")

  const system = `You are Emergy, a wise and warm nature spirit who lives in ${session.user.name ?? "the user"}'s habit garden. You speak with gentle warmth and the occasional plant metaphor. Keep every reply to 2–3 sentences maximum.

Garden state right now: ${habits.length} plants total, ${thriving} thriving (14+ day streak), ${done}/${habits.length} done today, ${wilting} wilting (3+ days missed). Weather: ${weather ? `${weather.temp}°C` : "unknown"}.
Habits: ${habitList || "none yet"}

Be specific about their actual habits when relevant. Never make up data not in the garden state above.`

  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...(history ?? []).slice(-6),
    { role: "user", content: message },
  ]

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 160,
    system,
    messages,
  })

  const text = response.content[0]?.type === "text" ? response.content[0].text : ""
  return NextResponse.json({ response: text })
}
