import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const books = await prisma.book.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  })

  return NextResponse.json(books)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { title, author, pages, status, coverColor } = await req.json()
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 })

  const book = await prisma.book.create({
    data: {
      userId, title,
      author: author ?? null,
      pages: pages ? parseInt(pages) : null,
      status: status ?? "reading",
      coverColor: coverColor ?? "#6366f1",
      startedAt: status === "reading" ? new Date() : null,
    },
  })

  return NextResponse.json(book, { status: 201 })
}
