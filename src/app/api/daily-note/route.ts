import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0]
  const dateObj = new Date(date + "T00:00:00.000Z")

  const note = await prisma.dailyNote.findUnique({
    where: { userId_date: { userId: session.user.id, date: dateObj } },
  })

  return NextResponse.json(note ?? { content: "" })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { content, date } = await req.json()
  const dateStr = date ?? new Date().toISOString().split("T")[0]
  const dateObj = new Date(dateStr + "T00:00:00.000Z")

  if (!content?.trim()) {
    await prisma.dailyNote.deleteMany({
      where: { userId: session.user.id, date: dateObj },
    })
    return NextResponse.json({ ok: true })
  }

  const note = await prisma.dailyNote.upsert({
    where: { userId_date: { userId: session.user.id, date: dateObj } },
    create: { userId: session.user.id, date: dateObj, content: content.trim() },
    update: { content: content.trim() },
  })

  return NextResponse.json(note)
}
