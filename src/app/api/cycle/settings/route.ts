import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { saveCycleSettings } from "@/lib/cycle-load"
import type { CycleSettings } from "@/lib/cycle"

export const dynamic = "force-dynamic"

// Partial updates: what is sent is merged over what is saved, then the whole
// thing goes through parseCycleSettings, so a bad value falls back to the
// default instead of being stored.
export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "settings required" }, { status: 400 })
  const settings = await saveCycleSettings(session.user.id, body as Partial<CycleSettings>)
  return NextResponse.json({ ok: true, settings })
}
