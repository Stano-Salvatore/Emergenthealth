import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await prisma.$executeRaw`ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "reminderTime" TEXT`.catch(() => {})
  await prisma.$executeRaw`ALTER TABLE "Reminder" ADD COLUMN IF NOT EXISTS "reminderTime" TEXT`.catch(() => {})

  return NextResponse.json({ ok: true })
}
