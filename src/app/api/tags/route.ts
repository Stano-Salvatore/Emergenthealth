import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tags = await prisma.tag.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
  })
  return NextResponse.json(tags)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { name, color } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 })

  const tag = await prisma.tag.upsert({
    where: { userId_name: { userId: session.user.id, name: name.trim() } },
    create: { userId: session.user.id, name: name.trim(), color: color ?? "#6366f1" },
    update: { color: color ?? "#6366f1" },
  })
  return NextResponse.json(tag, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await req.json()
  await prisma.tag.deleteMany({ where: { id, userId: session.user.id } })
  return NextResponse.json({ ok: true })
}
