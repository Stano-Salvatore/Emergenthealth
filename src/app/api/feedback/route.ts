import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Resend } from "resend"
import { checkRateLimit } from "@/lib/rate-limit"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const TYPE_EMOJI: Record<string, string> = {
  suggestion: "💡",
  bug: "🐛",
  love: "❤️",
}

async function notifyOwner(userName: string | null, userEmail: string | null, message: string, type: string) {
  if (!resend || !process.env.FEEDBACK_NOTIFY_EMAIL) return
  const emoji = TYPE_EMOJI[type] ?? "💬"
  await resend.emails.send({
    from: "Emergenthealth <noreply@emergenthealth.app>",
    to: process.env.FEEDBACK_NOTIFY_EMAIL,
    subject: `[Feedback] ${emoji} ${type} from ${userName ?? userEmail ?? "unknown"}`,
    html: `
      <p><strong>Type:</strong> ${emoji} ${type}</p>
      <p><strong>From:</strong> ${userName ?? "—"} (${userEmail ?? "—"})</p>
      <hr/>
      <p style="white-space:pre-wrap">${message}</p>
    `,
  }).catch(() => {})
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { allowed } = checkRateLimit(session.user.id, "feedback", 5, 60 * 60 * 1000)
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const { message, type = "suggestion" } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: "Too long" }, { status: 400 })

  await prisma.userFeedback.create({
    data: { userId: session.user.id, message: message.trim() as string, type: type as string },
  })

  await notifyOwner(session.user.name ?? null, session.user.email ?? null, message.trim(), type)

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ownerEmail = process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL
  if (!ownerEmail || session.user.email !== ownerEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const rows = await prisma.userFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { email: true, name: true } } },
  })

  return NextResponse.json(rows)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ownerEmail = process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL
  const isOwner = ownerEmail && session.user.email === ownerEmail

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  if (isOwner) {
    await prisma.userFeedback.deleteMany({ where: { id: id as string } })
  } else {
    await prisma.userFeedback.deleteMany({ where: { id: id as string, userId: session.user.id } })
  }

  return NextResponse.json({ ok: true })
}
