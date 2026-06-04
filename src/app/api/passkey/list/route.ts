import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const passkeys = await prisma.passkey.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true, deviceType: true, createdAt: true, lastUsedAt: true, backedUp: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(passkeys)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await req.json()

  await prisma.passkey.deleteMany({
    where: { id, userId: session.user.id },
  })

  return NextResponse.json({ ok: true })
}
