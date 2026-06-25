import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserPlan } from "@/lib/plan"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ plan: "free" })

  const plan = await getUserPlan(session.user.id)

  const sub = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
  }).catch(() => null)

  const isTrialing = sub?.status === "trialing"
  const trialDaysLeft = isTrialing && sub?.currentPeriodEnd
    ? Math.max(0, Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null

  return NextResponse.json({ plan, isTrialing, trialDaysLeft, cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false })
}
