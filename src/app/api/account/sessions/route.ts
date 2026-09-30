import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { currentSessionToken, sessionViews } from "@/lib/account-sessions"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const current = currentSessionToken(await cookies())
  const rows = await prisma.session.findMany({
    where: { userId: session.user.id },
    select: { id: true, sessionToken: true, createdAt: true, updatedAt: true, expires: true },
  })
  return NextResponse.json({ sessions: sessionViews(rows, current) })
}

/**
 * Ends one other session (`?id=`) or every other session. The one making the
 * request is never touched — that is what the ordinary Sign out is for.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const current = currentSessionToken(await cookies())
  // Without knowing which row is this device, "all the others" could be all
  // of them — the person would be signed out of the device they are holding.
  if (!current) return NextResponse.json({ error: "Couldn't tell which session is this device. Nothing was signed out." }, { status: 400 })

  const id = req.nextUrl.searchParams.get("id")
  const gone = await prisma.session.deleteMany({
    where: { userId: session.user.id, sessionToken: { not: current }, ...(id ? { id } : {}) },
  }).catch((e: unknown) => {
    console.error("[sessions] sign-out failed:", e)
    return null
  })
  if (!gone) return NextResponse.json({ error: "Signing out didn't go through. Nothing changed — try again." }, { status: 500 })
  return NextResponse.json({ ok: true, ended: gone.count })
}
