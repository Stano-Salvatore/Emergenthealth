import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"

export async function POST() {
  if (!isStripeConfigured() || !stripe) {
    return NextResponse.json({ error: "Payments not configured" }, { status: 503 })
  }

  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } })
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No subscription found" }, { status: 404 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://emergenthealth.vercel.app"

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${appUrl}/dashboard/settings`,
  })

  return NextResponse.json({ url: portalSession.url })
}
