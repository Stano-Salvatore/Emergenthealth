import Link from "next/link"
import type { Metadata } from "next"
import { auth } from "@/auth"
import { getUserPlan } from "@/lib/plan"
import { isStripeConfigured } from "@/lib/stripe"
import { PricingToggle } from "./PricingToggle"

export const metadata: Metadata = {
  title: "Pricing — Emergenthealth",
  description: "Simple, transparent pricing for Emergenthealth Pro.",
}

const FREE_FEATURES = [
  "Sleep, HRV & readiness from Oura",
  "Mood & energy tracking",
  "Up to 10 habits",
  "Water & drink logging",
  "Morning check-in",
  "30-day data history",
  "Weekly AI insights",
  "Google Calendar sync",
]

const PRO_FEATURES = [
  "Everything in Free",
  "Unlimited habits & routines",
  "Full data history (unlimited)",
  "Daily AI insights & correlations",
  "Finance tracking (bank sync, CSV import)",
  "Data export (CSV, JSON)",
  "Home screen widgets",
  "Daily email digest",
  "Priority background sync",
  "Early access to new features",
]

export default async function PricingPage() {
  const session = await auth()
  const plan = session?.user?.id ? await getUserPlan(session.user.id) : "free"
  const stripeReady = isStripeConfigured()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-12"
        >
          <span aria-hidden>←</span> Back to app
        </Link>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3">Simple pricing</h1>
          <p className="text-muted-foreground text-lg">
            Start free. Upgrade when you&apos;re ready.
          </p>
          {!stripeReady && (
            <div className="mt-4 inline-block rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-sm text-amber-400">
              Payments coming soon — Pro is free during beta
            </div>
          )}
        </div>

        <PricingToggle
          plan={plan}
          stripeReady={stripeReady}
          isSignedIn={!!session?.user}
          freeFeatures={FREE_FEATURES}
          proFeatures={PRO_FEATURES}
        />

        <div className="mt-12 text-center space-y-2 text-sm text-muted-foreground">
          <p>Cancel anytime. No questions asked.</p>
          <p>
            Questions?{" "}
            <a href="mailto:hello@emergenthealth.app" className="text-primary hover:underline">
              hello@emergenthealth.app
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
