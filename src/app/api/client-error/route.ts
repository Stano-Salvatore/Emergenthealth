import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

// Where the page's own errors land: the feedback inbox, as rows of type
// "error". Reusing UserFeedback rather than a new table is deliberate — the
// owner reads crashes beside the bug reports that usually describe them, and
// the export, backup and account deletion already cover the table.
//
// No email per row. One broken deploy can throw the same error from every
// phone at once, and an inbox full of identical mails is how the owner
// learns to ignore the sender.

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { allowed } = checkRateLimit(userId, "client-error", 20, 60 * 60 * 1000)
  if (!allowed) return NextResponse.json({ ok: true, dropped: "rate" })

  const body = await req.json().catch(() => null) as {
    message?: unknown; stack?: unknown; url?: unknown; build?: unknown; source?: unknown
  } | null
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 1000) : ""
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 })

  const url = typeof body?.url === "string" ? body.url.slice(0, 300) : "?"
  const source = typeof body?.source === "string" ? body.source.slice(0, 40) : "?"
  const build = typeof body?.build === "number" ? body.build : null
  const stack = typeof body?.stack === "string" ? body.stack.slice(0, 3000) : ""
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 200)

  // The first line is the fingerprint: one row per distinct error per user
  // per day, however many pages it fires on.
  const firstLine = message.split("\n")[0]
  const dup = await prisma.userFeedback.findFirst({
    where: {
      userId, type: "error",
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      message: { startsWith: firstLine },
    },
    select: { id: true },
  }).catch(() => null)
  if (dup) return NextResponse.json({ ok: true, dropped: "duplicate" })

  const record = [
    message,
    "",
    `at ${url} · via ${source}${build != null ? ` · build ${build}` : ""}`,
    ua,
    stack ? `\n${stack}` : "",
  ].join("\n").trim()

  await prisma.userFeedback.create({
    data: { userId, type: "error", message: record.slice(0, 5000) },
  }).catch(() => null)

  return NextResponse.json({ ok: true })
}
