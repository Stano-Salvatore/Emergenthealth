import Link from "next/link"
import type { Metadata } from "next"
import { auth } from "@/auth"
import { getUserPlan } from "@/lib/plan"
import { isStripeConfigured } from "@/lib/stripe"
import { CheckoutButton } from "./CheckoutButton"

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

        <div className="grid md:grid-cols-2 gap-6">
          {/* Free */}
          <div className="rounded-2xl border border-border bg-card p-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-1">Free</h2>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold">€0</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Everything you need to get started.
              </p>
            </div>

            <ul className="space-y-3 mb-8">
              {FREE_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {plan === "free" ? (
              <div className="w-full rounded-xl border border-border/60 bg-secondary/30 py-3 text-center text-sm text-muted-foreground">
                Current plan
              </div>
            ) : (
              <Link
                href="/dashboard"
                className="block w-full rounded-xl border border-border/60 bg-secondary/30 py-3 text-center text-sm text-muted-foreground hover:bg-secondary/60 transition-colors"
              >
                Go to dashboard →
              </Link>
            )}
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-primary/40 bg-card p-8 relative overflow-hidden">
            <div
              className="absolute inset-0 pointer-events-none opacity-30"
              style={{ background: "radial-gradient(ellipse at top right, color-mix(in srgb, var(--primary) 20%, transparent), transparent 70%)" }}
            />

            <div className="relative mb-6">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-xl font-bold">Pro</h2>
                <span className="rounded-full bg-primary/20 text-primary text-xs font-semibold px-2.5 py-0.5">
                  14-day free trial
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold">€6.99</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Or €59/year — save 30%.
              </p>
            </div>

            <ul className="relative space-y-3 mb-8">
              {PRO_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <span className="text-primary mt-0.5 shrink-0">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <div className="relative">
              {plan === "pro" ? (
                <div className="w-full rounded-xl bg-primary/10 border border-primary/30 py-3 text-center text-sm text-primary font-medium">
                  ✓ Active — manage in settings
                </div>
              ) : (
                <CheckoutButton stripeReady={stripeReady} isSignedIn={!!session?.user} />
              )}
            </div>
          </div>
        </div>

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
