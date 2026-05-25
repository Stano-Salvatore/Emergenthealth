import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = params
  const body = await req.json()
  const { status, rating, notes, pages, author, title, coverColor } = body

  const existing = await prisma.book.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (title !== undefined) data.title = title
  if (author !== undefined) data.author = author ?? null
  if (pages !== undefined) data.pages = pages ? parseInt(pages) : null
  if (coverColor !== undefined) data.coverColor = coverColor
  if (notes !== undefined) data.notes = notes ?? null
  if (rating !== undefined) data.rating = rating ? parseInt(rating) : null
  if (status !== undefined) {
    data.status = status
    if (status === "reading" && !existing.startedAt) data.startedAt = new Date()
    if (status === "done" && !existing.finishedAt) data.finishedAt = new Date()
  }

  const book = await prisma.book.update({ where: { id, userId }, data })
  return NextResponse.json(book)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = params
  const existing = await prisma.book.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.book.delete({ where: { id, userId } })
  return NextResponse.json({ ok: true })
}
