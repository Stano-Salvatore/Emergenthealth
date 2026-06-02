import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"
import type Stripe from "stripe"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  if (!stripe) return NextResponse.json({ error: "Not configured" }, { status: 503 })

  const body = await req.text()
  const sig = req.headers.get("stripe-signature") ?? ""
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) return NextResponse.json({ error: "Webhook secret not set" }, { status: 503 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode !== "subscription") break
      const userId = session.metadata?.userId
      if (!userId) break

      const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
      const item = subscription.items.data[0]
      const periodEnd = item?.current_period_end ?? null
      await prisma.subscription.upsert({
        where: { userId },
        create: {
          userId,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: subscription.id,
          stripePriceId: item?.price.id,
          status: subscription.status,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        },
        update: {
          stripeSubscriptionId: subscription.id,
          stripePriceId: item?.price.id,
          status: subscription.status,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        },
      })
      break
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription
      const item = subscription.items.data[0]
      const periodEnd = item?.current_period_end ?? null

      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          status: subscription.status,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
      })
      break
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      const parentSub = invoice.parent?.type === "subscription_details"
        ? invoice.parent.subscription_details?.subscription
        : null
      const subId = typeof parentSub === "string" ? parentSub : (parentSub as Stripe.Subscription | null)?.id
      if (!subId) break
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subId },
        data: { status: "past_due" },
      })
      break
    }
  }

  return NextResponse.json({ received: true })
}
