import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { digestDay: true, digestHour: true },
  })
  return NextResponse.json({ digestDay: user?.digestDay ?? 1, digestHour: user?.digestHour ?? 8 })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { digestDay, digestHour } = await req.json()
  if (typeof digestDay !== "number" || digestDay < 0 || digestDay > 6) {
    return NextResponse.json({ error: "digestDay must be 0-6" }, { status: 400 })
  }
  if (typeof digestHour !== "number" || digestHour < 0 || digestHour > 23) {
    return NextResponse.json({ error: "digestHour must be 0-23" }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { digestDay, digestHour },
  })
  return NextResponse.json({ ok: true, digestDay, digestHour })
}
