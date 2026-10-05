import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"
import { HAIKU } from "@/lib/models"
import { recordModelTurn } from "@/lib/model-spend"
import { claimEmergyTurn, quotaReply, refundEmergyTurn } from "@/lib/emergy-quota"

const anthropic = new Anthropic()

interface HabitCtx {
  name: string
  streak: number
  missedDays: number
  completedToday: boolean
}

// The garden sends its own state up with each message; none of it is trusted
// for more than a prompt, but all of it is paid for, so each part is capped.
const MAX_MESSAGE = 1000
const MAX_TURNS = 6
const MAX_HABITS = 100

function habitsFrom(raw: unknown): HabitCtx[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_HABITS).flatMap(h => {
    if (!h || typeof h !== "object") return []
    const o = h as Record<string, unknown>
    if (typeof o.name !== "string") return []
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)
    return [{ name: o.name.slice(0, 80), streak: n(o.streak), missedDays: n(o.missedDays), completedToday: o.completedToday === true }]
  })
}

function historyFrom(raw: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .slice(-MAX_TURNS)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }))
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const message = typeof body?.message === "string" ? body.message.trim() : ""
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 })
  if (message.length > MAX_MESSAGE) return NextResponse.json({ error: "That message is too long." }, { status: 400 })
  const habits = habitsFrom(body?.habits)
  const history = historyFrom(body?.history)
  const w = body?.weather as { temp?: unknown } | null | undefined
  const temp = typeof w?.temp === "number" && Number.isFinite(w.temp) ? Math.round(w.temp) : null

  // The same Emergy on the same bill as the chat: it spends the same allowance.
  if (!(await claimEmergyTurn(session.user.id)).allowed) {
    return NextResponse.json({ response: quotaReply("garden") })
  }

  const thriving = habits.filter(h => h.streak >= 14).length
  const wilting  = habits.filter(h => h.missedDays >= 3).length
  const done     = habits.filter(h => h.completedToday).length

  const habitList = habits.map(h =>
    `${h.name}: streak=${h.streak}d, missed=${h.missedDays}d, today=${h.completedToday ? "✓" : "✗"}`
  ).join(" | ")

  const system = `You are Emergy, a wise and warm nature spirit who lives in ${session.user.name ?? "the user"}'s habit garden. You speak with gentle warmth and the occasional plant metaphor. Keep every reply to 2–3 sentences maximum.

Garden state right now: ${habits.length} plants total, ${thriving} thriving (14+ day streak), ${done}/${habits.length} done today, ${wilting} wilting (3+ days missed). Weather: ${temp !== null ? `${temp}°C` : "unknown"}.
Habits: ${habitList || "none yet"}

Be specific about their actual habits when relevant. Never make up data not in the garden state above.`

  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...history,
    { role: "user", content: message },
  ]

  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 160,
      system,
      messages,
    })
  } catch (error) {
    console.error("[garden] emergy failed", error instanceof Error ? error.message : error)
    await refundEmergyTurn(session.user.id)
    return NextResponse.json({ error: "Emergy couldn't answer just now — try again in a moment." }, { status: 502 })
  }

  recordModelTurn({
    userId: session.user.id, model: HAIKU, feature: "garden",
    stopReason: response.stop_reason, usage: response.usage,
  })

  const text = response.content[0]?.type === "text" ? response.content[0].text : ""
  return NextResponse.json({ response: text })
}
