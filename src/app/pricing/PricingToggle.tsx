"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckoutButton } from "./CheckoutButton"

interface PricingToggleProps {
  plan: string
  stripeReady: boolean
  isSignedIn: boolean
  freeFeatures: string[]
  proFeatures: string[]
}

export function PricingToggle({ plan, stripeReady, isSignedIn, freeFeatures, proFeatures }: PricingToggleProps) {
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly")

  return (
    <div className="space-y-8">
      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setPeriod("monthly")}
          className={`text-sm font-medium transition-colors ${period === "monthly" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Monthly
        </button>
        <button
          onClick={() => setPeriod(p => p === "monthly" ? "annual" : "monthly")}
          className="relative h-6 w-11 rounded-full bg-primary/20 transition-colors hover:bg-primary/30"
          role="switch"
          aria-checked={period === "annual"}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-primary shadow transition-transform ${period === "annual" ? "translate-x-5" : ""}`}
          />
        </button>
        <button
          onClick={() => setPeriod("annual")}
          className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${period === "annual" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Annual
          <span className="rounded-full bg-green-500/15 text-green-400 text-[10px] font-bold px-2 py-0.5">
            Save 30%
          </span>
        </button>
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
            {freeFeatures.map(f => (
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
              {period === "annual" ? (
                <>
                  <span className="text-4xl font-bold">€4.92</span>
                  <span className="text-muted-foreground">/month</span>
                  <span className="text-xs text-muted-foreground ml-1">(€59/year)</span>
                </>
              ) : (
                <>
                  <span className="text-4xl font-bold">€6.99</span>
                  <span className="text-muted-foreground">/month</span>
                </>
              )}
            </div>
            {period === "monthly" ? (
              <p className="text-sm text-muted-foreground mt-2">
                Or{" "}
                <button onClick={() => setPeriod("annual")} className="text-primary hover:underline font-medium">
                  €59/year — save 30%
                </button>
              </p>
            ) : (
              <p className="text-sm text-green-400 mt-2 font-medium">
                Billed annually — saving €24.88/year
              </p>
            )}
          </div>

          <ul className="relative space-y-3 mb-8">
            {proFeatures.map(f => (
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
              <CheckoutButton stripeReady={stripeReady} isSignedIn={isSignedIn} period={period} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
