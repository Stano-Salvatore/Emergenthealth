import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { format, subDays } from "date-fns"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const stored = await prisma.ouraToken.findUnique({ where: { userId: session.user.id } })
  if (!stored?.accessToken) return NextResponse.json({ error: "Not connected" }, { status: 400 })

  const end = format(new Date(), "yyyy-MM-dd")
  const start = format(subDays(new Date(), 7), "yyyy-MM-dd")

  const url = new URL("https://api.ouraring.com/v2/usercollection/enhanced_tag")
  url.searchParams.set("start_date", start)
  url.searchParams.set("end_date", end)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${stored.accessToken}` },
  })
  const raw = await res.json()

  // Return the raw items so we can see exactly what fields come back
  return NextResponse.json({ items: raw.data ?? [], status: res.status })
}
