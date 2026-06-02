import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { stripe, STRIPE_PRO_PRICE_ID, isStripeConfigured } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  if (!isStripeConfigured() || !stripe) {
    return NextResponse.json({ error: "Payments not configured" }, { status: 503 })
  }

  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://emergenthealth.vercel.app"

  // Get or create Stripe customer
  let sub = await prisma.subscription.findUnique({ where: { userId } })
  let customerId = sub?.stripeCustomerId

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      name: session.user.name ?? undefined,
      metadata: { userId },
    })
    customerId = customer.id
    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    })
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl}/dashboard/settings?upgraded=1`,
    cancel_url: `${appUrl}/pricing`,
    allow_promotion_codes: true,
    subscription_data: {
      trial_period_days: 14,
      metadata: { userId },
    },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
