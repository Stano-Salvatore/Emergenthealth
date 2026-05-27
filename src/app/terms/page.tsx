import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service — Emergenthealth",
}

export default function TermsPage() {
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

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground text-sm mb-10">Last updated: May 2026</p>

        <div className="space-y-10 text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Acceptance of terms</h2>
            <p>
              By signing in to Emergenthealth, you agree to these Terms of Service. If you do not
              agree, please do not use the app. These terms apply to all users of the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">What Emergenthealth is</h2>
            <p>
              Emergenthealth is a personal health and life dashboard designed for individual use. It
              aggregates data from health trackers, financial tools, and productivity services to
              give you a unified view of your wellbeing. It is not a medical service, a financial
              advisory service, or a clinical tool.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Your data</h2>
            <p>
              You own your data. By using the app, you grant Emergenthealth a limited license to
              process your data solely to provide the service to you. We do not claim ownership of
              any content you create or data you connect.
            </p>
            <p className="mt-3">
              You are responsible for ensuring that connecting third-party accounts (Oura, YNAB,
              Strava, etc.) complies with those services' own terms. Emergenthealth is not
              affiliated with or endorsed by any of the third-party services it integrates with.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Acceptable use</h2>
            <p className="mb-3">
              Emergenthealth is for personal, non-commercial use. You agree not to:
            </p>
            <ul className="space-y-2 list-none pl-0">
              {[
                "Share your account with others or use the service on behalf of a third party",
                "Attempt to access another user's data",
                "Use automated scripts or bots to scrape or overload the service",
                "Reverse engineer, decompile, or attempt to extract the source code",
                "Use the service for any unlawful purpose",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">AI features</h2>
            <p>
              Emergenthealth uses Anthropic Claude to generate insights, summaries, and suggestions
              based on your data. These AI-generated outputs are for informational purposes only.
            </p>
            <p className="mt-3 font-medium text-foreground/80">
              AI insights are not medical advice. Do not make health or medical decisions based
              solely on outputs from this app. Always consult a qualified healthcare professional
              for medical questions.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Disclaimer and liability</h2>
            <p>
              Emergenthealth is provided "as is" without warranties of any kind, express or implied.
              We do not guarantee uptime, data accuracy, or that the service will meet your specific
              needs.
            </p>
            <p className="mt-3">
              To the fullest extent permitted by applicable law, Emergenthealth is not liable for
              any indirect, incidental, or consequential damages arising from your use of the
              service — including but not limited to health decisions, financial decisions, or data
              loss.
            </p>
            <p className="mt-3">
              We are a small independent project. We take care to build things well, but we are not
              a large company with deep pockets or legal teams. Please use the app accordingly.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Termination</h2>
            <p>
              You may stop using Emergenthealth at any time. You can permanently delete your account
              and all associated data from{" "}
              <Link href="/dashboard/settings" className="text-primary hover:underline">
                Settings → Export &amp; Delete
              </Link>
              .
            </p>
            <p className="mt-3">
              We reserve the right to suspend or terminate accounts that violate these terms, though
              we will try to give notice where possible.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Changes to these terms</h2>
            <p>
              We may update these terms from time to time. The updated date at the top of this page
              reflects the most recent revision. Continued use of the app after changes constitutes
              acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Governing law</h2>
            <p>
              These terms are governed by the laws of the jurisdiction in which Emergenthealth
              operates. Any disputes will be resolved in the appropriate courts of that jurisdiction.
              [Jurisdiction to be specified]
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Contact</h2>
            <p>
              Questions about these terms? Email us at{" "}
              <a
                href="mailto:legal@emergenthealth.app"
                className="text-primary hover:underline"
              >
                legal@emergenthealth.app
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
          <Link href="/privacy" className="hover:text-muted-foreground transition-colors">
            Privacy Policy →
          </Link>
        </div>
      </div>
    </div>
  )
}
