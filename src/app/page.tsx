import { redirect } from "next/navigation"
import { auth } from "@/auth"
import Link from "next/link"
import { NewsletterForm } from "@/components/ui/NewsletterForm"

export default async function HomePage() {
  const session = await auth()
  if (session?.user) {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div
          className="absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 6%, transparent) 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-1/3 -right-60 w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 5%, transparent) 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 4%, transparent) 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10">
        {/* Nav */}
        <nav className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight text-primary">
            ◉ Emergenthealth
          </span>
          <div className="flex items-center gap-5">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link
              href="/signin"
              className="text-sm text-muted-foreground transition-colors hover:opacity-80"
            >
              Sign in
            </Link>
          </div>
        </nav>

        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-28 text-center">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-6">
            Your health, finally<br />in one place.
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Connect your wearables, apps, and habits. See patterns you&apos;d never notice alone.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/signin"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started free →
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium border text-muted-foreground transition-colors hover:opacity-80"
              style={{ borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)" }}
            >
              See what it tracks ↓
            </a>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-6xl mx-auto px-6 pb-28">
          <h2 className="text-center text-2xl font-semibold mb-12">
            Everything about you, connected
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                emoji: "🩺",
                name: "Health metrics",
                desc: "Sleep, HRV, readiness, and steps from Oura Ring, auto-synced daily.",
              },
              {
                emoji: "📊",
                name: "Smart correlations",
                desc: "Discover if rain affects your mood or bad sleep tanks your steps.",
              },
              {
                emoji: "💰",
                name: "Finances",
                desc: "YNAB spending trends, category breakdowns, and monthly patterns.",
              },
              {
                emoji: "🤖",
                name: "AI insights",
                desc: "Weekly digest and daily bullet points from Claude, based on your actual data.",
              },
              {
                emoji: "🏃",
                name: "Activities",
                desc: "Strava workouts, GPS tracks, coding streaks, and music listening.",
              },
              {
                emoji: "🎯",
                name: "Habits & goals",
                desc: "Daily habit streaks, custom trackers, and a morning check-in ritual.",
              },
            ].map(({ emoji, name, desc }) => (
              <div
                key={name}
                className="rounded-2xl p-6 border border-border/80 bg-card/30"
              >
                <div className="text-3xl mb-3">{emoji}</div>
                <h3 className="font-semibold mb-2 text-base">{name}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Integrations strip */}
        <section className="max-w-6xl mx-auto px-6 pb-28">
          <h2 className="text-center text-sm font-medium uppercase tracking-widest mb-8 text-muted-foreground">
            Works with what you already use
          </h2>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
            {[
              { emoji: "💍", label: "Oura Ring" },
              { emoji: "📅", label: "Google Calendar" },
              { emoji: "🚴", label: "Strava" },
              { emoji: "💵", label: "YNAB" },
              { emoji: "🎵", label: "Last.fm" },
              { emoji: "⏱️", label: "RescueTime" },
              { emoji: "🐙", label: "GitHub" },
              { emoji: "📍", label: "GPSLogger" },
            ].map(({ emoji, label }) => (
              <span
                key={label}
                className="text-sm text-muted-foreground flex items-center gap-1.5"
              >
                <span>{emoji}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
          <div className="rounded-2xl border border-border/80 bg-card/30 p-8 flex flex-col sm:flex-row items-center gap-6">
            <div className="flex-1 text-left">
              <p className="font-semibold mb-1">Free to start, Pro when you need more</p>
              <p className="text-sm text-muted-foreground">
                Free plan covers the basics. Pro unlocks unlimited history, daily AI insights, bank sync, and data export.
              </p>
            </div>
            <Link
              href="/pricing"
              className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
            >
              See pricing →
            </Link>
          </div>
        </section>

        {/* FAQ */}
        {(() => {
          const faqs = [
            {
              q: "Is it free?",
              a: "Yes — the core features are free. A Pro plan (€6.99/month) unlocks unlimited history, daily AI insights, finance tracking, and data export. Free plan includes all the basics.",
            },
            {
              q: "What data sources does it support?",
              a: "Oura Ring (sleep & readiness), Strava (workouts), YNAB (budget), GitHub (coding activity), RescueTime (focus), Last.fm (music), Google Calendar, and more integrations are added regularly.",
            },
            {
              q: "Where is my data stored?",
              a: "Your data lives in a private database (Neon PostgreSQL). We never sell your data or share it with advertisers.",
            },
            {
              q: "Does it work on my phone?",
              a: "Yes — Emergenthealth is a PWA. You can install it on your home screen from Safari (iOS) or Chrome (Android) and it works like a native app.",
            },
            {
              q: "Do I need all the integrations?",
              a: "No — connect only what you care about. The dashboard adapts to show only the data you've connected.",
            },
            {
              q: "Is there a mobile app?",
              a: "The web app works great on mobile as a PWA — install it on your home screen. A native Android app (via Median.co) is available for download now.",
            },
          ]
          return (
            <section className="max-w-3xl mx-auto px-6 pb-28">
              <h2 className="text-center text-2xl font-semibold mb-12">
                Frequently asked questions
              </h2>
              <div
                className="space-y-0 divide-y"
                style={{ borderColor: "color-mix(in srgb, var(--primary) 15%, transparent)" }}
              >
                {faqs.map((faq) => (
                  <div key={faq.q} className="py-5">
                    <p className="font-medium text-sm mb-1.5">{faq.q}</p>
                    <p className="text-sm text-muted-foreground">{faq.a}</p>
                  </div>
                ))}
              </div>
            </section>
          )
        })()}

        {/* CTA */}
        <section className="max-w-6xl mx-auto px-6 pb-28 text-center">
          <div
            className="rounded-3xl px-8 py-16 mx-auto max-w-2xl"
            style={{
              border: "1px solid color-mix(in srgb, var(--primary) 15%, transparent)",
              background: "color-mix(in srgb, var(--primary) 4%, transparent)",
            }}
          >
            <h2 className="text-3xl font-bold mb-4 tracking-tight">
              Ready to understand yourself better?
            </h2>
            <p className="text-base text-muted-foreground mb-8">
              Sign in with Google to get started. Free, private, your data stays yours.
            </p>
            <Link
              href="/signin"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started →
            </Link>

            <div
              className="mt-10 pt-8"
              style={{ borderTop: "1px solid color-mix(in srgb, var(--primary) 10%, transparent)" }}
            >
              <p className="text-xs text-muted-foreground/70 mb-4">
                Not ready yet? Get notified when new integrations launch.
              </p>
              <NewsletterForm />
            </div>

            <p className="mt-6 text-xs text-muted-foreground/60">
              <Link href="/privacy" className="hover:opacity-80 transition-opacity">Privacy policy</Link>
              {" · "}
              <Link href="/terms" className="hover:opacity-80 transition-opacity">Terms of service</Link>
            </p>
          </div>
        </section>

        {/* Footer */}
        <footer className="max-w-6xl mx-auto px-6 pb-8 text-center">
          <p className="text-xs text-muted-foreground/40">
            © 2026 Emergenthealth{" · "}
            <Link href="/privacy" className="hover:opacity-80 transition-opacity">Privacy</Link>
            {" · "}
            <Link href="/terms" className="hover:opacity-80 transition-opacity">Terms</Link>
          </p>
        </footer>
      </div>
    </div>
  )
}
