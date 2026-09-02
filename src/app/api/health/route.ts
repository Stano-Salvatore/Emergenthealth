import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Is the deploy alive and can it reach the database? Public and cheap by
// design: an uptime monitor polls it, and a 503 here is the earliest signal
// that Neon is paused, a connection string rotated, or a deploy is broken —
// before a cron quietly 500s for a week. It says nothing about any user.
export async function GET() {
  const started = Date.now()
  let db: "ok" | "error" = "error"
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ])
    db = "ok"
  } catch {
    db = "error"
  }
  const ok = db === "ok"
  return NextResponse.json(
    { ok, db, latencyMs: Date.now() - started, sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  )
}
