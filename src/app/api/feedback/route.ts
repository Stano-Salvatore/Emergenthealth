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

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "UserFeedback" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "userId" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'suggestion',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("id"),
      CONSTRAINT "UserFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
    )
  `
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { allowed } = checkRateLimit(session.user.id, "feedback", 5, 60 * 60 * 1000) // 5/hr
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const { message, type = "suggestion" } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: "Too long" }, { status: 400 })

  await ensureTable()

  await prisma.$executeRaw`
    INSERT INTO "UserFeedback" ("userId", "message", "type")
    VALUES (${session.user.id}, ${message.trim()}, ${type})
  `

  await notifyOwner(session.user.name ?? null, session.user.email ?? null, message.trim(), type)

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Only the app owner (configured via env) can read all feedback
  const ownerEmail = process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL
  if (!ownerEmail || session.user.email !== ownerEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await ensureTable()

  const rows = await prisma.$queryRaw<{ id: string; userId: string; message: string; type: string; createdAt: Date }[]>`
    SELECT f.id, f."userId", f.message, f.type, f."createdAt", u.email, u.name
    FROM "UserFeedback" f
    JOIN "User" u ON u.id = f."userId"
    ORDER BY f."createdAt" DESC
    LIMIT 100
  `

  return NextResponse.json(rows)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ownerEmail = process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL
  const isOwner = ownerEmail && session.user.email === ownerEmail

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  // Owner can delete any; regular users can only delete their own
  if (isOwner) {
    await prisma.$executeRaw`DELETE FROM "UserFeedback" WHERE id = ${id}`
  } else {
    await prisma.$executeRaw`DELETE FROM "UserFeedback" WHERE id = ${id} AND "userId" = ${session.user.id}`
  }

  return NextResponse.json({ ok: true })
}
