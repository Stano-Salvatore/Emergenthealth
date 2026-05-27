import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy — Emergenthealth",
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-10"
        >
          <span aria-hidden>←</span> Back to app
        </Link>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm mb-10">Last updated: May 2026</p>

        <div className="space-y-10 text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">The short version</h2>
            <p>
              Emergenthealth is a personal health dashboard — it pulls together your health, fitness,
              finance, and productivity data in one place, just for you. Your data is never sold,
              never shared with advertisers, and never used to train AI models. It stays yours.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">What we collect</h2>
            <p className="mb-3">
              Emergenthealth collects data that you explicitly connect or enter. This includes:
            </p>
            <ul className="space-y-2 list-none pl-0">
              {[
                "Health metrics — sleep, steps, heart rate variability, and recovery scores from Oura Ring",
                "Financial data — spending categories and transaction summaries from YNAB",
                "Calendar events — event titles, times, and attendees from Google Calendar",
                "Location check-ins — places you manually log in the Journal",
                "Mood and habit logs — entries you create directly in the app",
                "Listening history — recently played tracks from Last.fm",
                "Computer activity — app and category usage time from RescueTime",
                "Fitness activities — runs, rides, and workouts from Strava",
                "Authentication data — your name, email address, and profile photo from Google Sign-In",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3">
              We do not collect data in the background. We only fetch data when you load the app or
              when a background sync you have enabled runs.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">How we use your data</h2>
            <p className="mb-3">Your data is used exclusively to:</p>
            <ul className="space-y-2 list-none pl-0">
              {[
                "Display your health and life metrics on your dashboard",
                "Generate AI-powered insights and summaries using Anthropic Claude (your data is sent as part of prompts — see Third-party services below)",
                "Power trend charts and historical views",
                "Deliver email digests if you opt in",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3">
              We do not use your data for advertising, profiling, or any purpose beyond making the
              app work for you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Third-party services</h2>
            <p className="mb-4">
              We integrate with the following services. Each receives only the data necessary for
              its specific function:
            </p>
            <div className="space-y-4">
              {[
                {
                  name: "Google OAuth",
                  desc: "Used for sign-in only. We receive your name, email, and profile photo. We do not access your Google account data beyond what you explicitly authorize.",
                },
                {
                  name: "Anthropic Claude API",
                  desc: "Your health metrics and journal entries are sent to Anthropic's API to generate AI insights. Anthropic's API usage policy applies. Data sent to the API is not used to train Anthropic's models.",
                },
                {
                  name: "Oura API",
                  desc: "Sleep, activity, and HRV data is fetched from your Oura account with your permission.",
                },
                {
                  name: "YNAB API",
                  desc: "Spending categories and budget data are fetched from your YNAB account with your permission.",
                },
                {
                  name: "Strava API",
                  desc: "Fitness activities are fetched from your Strava account with your permission.",
                },
                {
                  name: "Last.fm API",
                  desc: "Recently played tracks are fetched using your Last.fm username (public data).",
                },
                {
                  name: "RescueTime API",
                  desc: "App and category usage data is fetched from your RescueTime account with your permission.",
                },
                {
                  name: "Open-Meteo",
                  desc: "Weather data is fetched anonymously based on your approximate location. No personal data is sent.",
                },
              ].map(({ name, desc }) => (
                <div key={name}>
                  <p className="font-medium text-foreground">{name}</p>
                  <p className="text-sm mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Data storage</h2>
            <p>
              Your data is stored in a Neon PostgreSQL database. Data is encrypted at rest and in
              transit. Databases are hosted in EU and US data centers. API tokens for connected
              services are stored encrypted in the database.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Your rights</h2>
            <p>
              You can export or permanently delete all your data at any time from{" "}
              <Link href="/dashboard/settings" className="text-primary hover:underline">
                Settings → Export &amp; Delete
              </Link>
              . Deletion is immediate and irreversible — we do not keep backups of deleted accounts.
            </p>
            <p className="mt-3">
              You can disconnect any third-party integration at any time from the Settings page.
              Disconnecting removes the stored access token but does not delete the data already
              synced.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Cookies</h2>
            <p>
              We use a single session cookie to keep you signed in. We do not use tracking cookies,
              analytics cookies, or advertising cookies. The session cookie is deleted when you sign
              out.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Changes to this policy</h2>
            <p>
              We may update this policy as the app evolves. Significant changes will be noted at the
              top of this page with an updated date. Continued use of the app after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Contact</h2>
            <p>
              Questions about privacy? Email us at{" "}
              <a
                href="mailto:privacy@emergenthealth.app"
                className="text-primary hover:underline"
              >
                privacy@emergenthealth.app
              </a>
              .
            </p>
          </section>
        </div>

        {/* Footer nav */}
        <div className="mt-14 pt-6 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground/50">
          <Link href="/dashboard" className="hover:text-muted-foreground transition-colors">
            ← Back to app
          </Link>
          <Link href="/terms" className="hover:text-muted-foreground transition-colors">
            Terms of Service →
          </Link>
        </div>
      </div>
    </div>
  )
}
