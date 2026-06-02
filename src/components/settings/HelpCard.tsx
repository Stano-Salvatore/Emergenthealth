"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronDown, ChevronRight, Mail, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const FAQS = [
  {
    q: "How do I sync my Oura Ring data?",
    a: "Go to Settings → Oura Ring and tap 'Connect'. You'll be redirected to Oura's authorization page. Once connected, data syncs automatically every morning via a scheduled cron job. You can also trigger a manual sync by tapping 'Sync now'.",
  },
  {
    q: "Why isn't my bank connected?",
    a: "Bank connections use TrueLayer, Salt Edge, or GoCardless depending on your region. If the connection fails, try disconnecting and reconnecting. Make sure to complete the bank's own authentication flow fully before being redirected back.",
  },
  {
    q: "How does the habit streak work?",
    a: "A streak counts consecutive days where you completed the habit. Missing a day resets the streak to 0. Use Vacation Mode (on the Habits page) to freeze streaks for a set period — perfect for holidays or illness.",
  },
  {
    q: "What is the wellness score?",
    a: "The wellness score (0–100) combines four pillars: Sleep (25 pts), Steps (25 pts), Readiness from Oura (25 pts), and Habit completion (25 pts). It gives you a quick daily pulse on how you're doing overall.",
  },
  {
    q: "How do I install the app on my phone?",
    a: "On Android: open the app in Chrome, tap the menu (⋮), then 'Add to Home screen'. On iOS (Safari): tap the Share icon, then 'Add to Home Screen'. The app works fully offline once installed.",
  },
  {
    q: "How do I cancel my Pro subscription?",
    a: "Go to Settings → Manage Billing. This opens Stripe's billing portal where you can cancel, update payment methods, or download invoices. Your Pro access continues until the end of your billing period.",
  },
  {
    q: "My morning reminder isn't arriving — why?",
    a: "Make sure you've granted notification permission (Settings → Push Notifications) and that your browser isn't blocking notifications. Morning reminders are sent at 7 AM UTC and only if you haven't completed a check-in yet that day.",
  },
  {
    q: "Can I export my data?",
    a: "Yes. Go to Settings → Data → Export CSV to download the last 90 days of health logs. You can also request a full daily digest email from the same section.",
  },
]

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        className="w-full flex items-center gap-2 py-3 text-left hover:text-foreground transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className={cn("text-sm font-medium", open ? "text-foreground" : "text-muted-foreground")}>{q}</span>
      </button>
      {open && (
        <p className="text-xs text-muted-foreground leading-relaxed pb-3 pl-5.5">{a}</p>
      )}
    </div>
  )
}

export function HelpCard() {
  const [showFaq, setShowFaq] = useState(false)

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Help &amp; Support</p>

        <div className="flex flex-col sm:flex-row gap-3">
          <a
            href="mailto:hello@emergenthealth.app"
            className="flex items-center gap-2.5 flex-1 rounded-xl border border-border hover:border-primary/40 bg-secondary/20 hover:bg-secondary/40 px-4 py-3 transition-all"
          >
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">Email support</p>
              <p className="text-[11px] text-muted-foreground">hello@emergenthealth.app</p>
            </div>
          </a>
          <a
            href="https://github.com/stano-salvatore/emergenthealth/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 flex-1 rounded-xl border border-border hover:border-primary/40 bg-secondary/20 hover:bg-secondary/40 px-4 py-3 transition-all"
          >
            <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">Report a bug</p>
              <p className="text-[11px] text-muted-foreground">Open a GitHub issue</p>
            </div>
          </a>
        </div>

        <div>
          <button
            onClick={() => setShowFaq(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showFaq ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Frequently asked questions
          </button>

          {showFaq && (
            <div className="mt-3 space-y-0">
              {FAQS.map(({ q, a }) => <FAQItem key={q} q={q} a={a} />)}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
