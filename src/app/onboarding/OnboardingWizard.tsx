"use client"

// The first-run wizard. Every step either saves something the app reads —
// Goals, the cycle settings, a connection, a push subscription — or explains
// what the rest is for; nothing is asked and then thrown away. Skipping the
// whole wizard still records it as done, or the dashboard would send them
// straight back here.
//
// Laid out for a phone first: a step scrolls, its buttons stay at the bottom
// of the screen, and the way back is the arrow in the header.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, Bell, BellOff, Check, ChevronLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { iosNeedsHomeScreen, isAppleMobile, subscribeWebPush } from "@/lib/web-push"
import { isNativeShell } from "@/lib/native/shell"
import { useClientValue } from "@/lib/use-client-value"
import { todayLocalISO } from "@/lib/local-date"
import { onboardingSteps, type OnboardingConnections, type OnboardingStep } from "@/lib/onboarding-steps"
import { CONTRACEPTION, type Contraception } from "@/lib/cycle"
import { CONTRACEPTION_GUIDE } from "@/lib/cycle-guide"
import { CONFIDENT_N, EARLIEST_CONFIDENT_DAY, EARLIEST_TEST_DAY, MIN_GROUP_DAYS } from "@/lib/pattern-rules"
import { PatternsStep } from "@/components/onboarding/PatternsStep"
import { AppleHealthQuickSetupStandalone } from "@/components/settings/AppleHealthQuickSetup"
import { TimezoneSync } from "@/components/TimezoneSync"

type Sex = "male" | "female" | null

export interface WizardProps {
  firstName: string | null
  initial: {
    sex: Sex
    birthYear: number | null
    weightKg: number | null
    heightCm: number | null
    tracksCycle: boolean | null
    lastStart: string | null
    contraception: Contraception
  }
  connections: OnboardingConnections
  startAt: OnboardingStep
  connectError: "oura" | "strava" | "strava_closed" | null
  /** The shared Apple Health shortcut (lib/apple-shortcut): with it, an iPhone connects right here. */
  shortcutUrl?: string | null
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Header({ index, total, onBack }: { index: number; total: number; onBack: (() => void) | null }) {
  return (
    <div className="mb-6 flex h-10 items-center gap-3">
      <button
        type="button"
        onClick={onBack ?? undefined}
        disabled={!onBack}
        aria-label="Back"
        className={cn(
          "-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground",
          !onBack && "invisible",
        )}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div
        className="flex flex-1 gap-1.5"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={index + 1}
      >
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i <= index ? "bg-primary" : "bg-border")} />
        ))}
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}/{total}</span>
    </div>
  )
}

// On a phone the buttons stay at the bottom of the screen while a long step
// scrolls under a fade; from the small breakpoint up they sit at the foot of
// the card.
function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-auto bg-gradient-to-t from-background from-75% to-transparent px-5 pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:bg-none sm:px-0 sm:pt-8 sm:pb-0">
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 leading-relaxed text-muted-foreground">{children}</p>
}

function Callout({ tone = "plain", children }: { tone?: "plain" | "warn" | "ok"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm",
        tone === "warn" ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : tone === "ok" ? "border-green-500/30 bg-green-500/10 text-green-200"
          : "border-border bg-card/60 text-muted-foreground",
      )}
    >
      {children}
    </div>
  )
}

/** A one-of-several choice, read out as a set of pressed/unpressed buttons. */
function Choice<T extends string | boolean | null>({ label, options, value, onChange }: {
  label: string
  options: readonly (readonly [T, string])[]
  value: T | undefined
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className={cn("mt-1.5 grid gap-2", options.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {options.map(([v, text]) => (
          <button
            key={text}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "min-h-11 rounded-xl border px-3 py-2 text-sm leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === v
                ? "border-primary bg-primary font-medium text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function PrivacyNote() {
  return (
    <p className="text-xs text-muted-foreground">
      All optional, and changeable later in Settings.{" "}
      <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">How your data is handled</a>
    </p>
  )
}

function ConnectRow({ emoji, name, hint, connected, href, onClick, busy, later }: {
  emoji: string; name: string; hint: string; connected: boolean
  href?: string; onClick?: () => void; busy?: boolean
  /** Set up elsewhere, after the wizard: said, rather than offered as a button that leaves it. */
  later?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="shrink-0 text-xl" aria-hidden>{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{name}</div>
        <div className="text-xs leading-snug text-muted-foreground">{hint}</div>
      </div>
      {connected ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-green-400"><Check className="h-3.5 w-3.5" />Connected</span>
      ) : later ? (
        <span className="shrink-0 text-right text-[11px] leading-tight text-muted-foreground">{later}</span>
      ) : href ? (
        <Button size="sm" variant="outline" asChild><a href={href}>Connect</a></Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onClick} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Connect"}
        </Button>
      )}
    </div>
  )
}

// ── The wizard ───────────────────────────────────────────────────────────────

export function OnboardingWizard({ firstName, initial, connections, startAt, connectError, shortcutUrl = null }: WizardProps) {
  const router = useRouter()
  const needsHomeScreen = useClientValue(() => iosNeedsHomeScreen(), false)
  const native = useClientValue(() => isNativeShell(), false)
  const apple = useClientValue(() => isAppleMobile() && !isNativeShell(), false)
  // The browser's own day: a period cannot have started tomorrow wherever the
  // user is standing, and the server's UTC day is the wrong question.
  const today = useClientValue(() => todayLocalISO(), "")

  const [step, setStep] = useState<OnboardingStep>(startAt)
  // undefined is "not answered yet", which is not the same as "rather not
  // say": only the second is a choice, and only a choice is saved — as a
  // clear, so it can take back an answer given before.
  const [sex, setSex] = useState<Sex | undefined>(initial.sex ?? undefined)
  const [birthYear, setBirthYear] = useState(initial.birthYear?.toString() ?? "")
  const [weightKg, setWeightKg] = useState(initial.weightKg?.toString() ?? "")
  const [heightCm, setHeightCm] = useState(initial.heightCm?.toString() ?? "")
  const [tracksCycle, setTracksCycle] = useState<boolean | null>(initial.tracksCycle)
  const [lastStart, setLastStart] = useState(initial.lastStart ?? "")
  const [contraception, setContraception] = useState<Contraception>(initial.contraception)
  const [hc, setHc] = useState<"idle" | "busy" | "done" | "failed">("idle")
  const [notif, setNotif] = useState<"idle" | "enabling" | "granted" | "denied">("idle")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const steps = onboardingSteps({ sex: sex ?? null })
  const index = Math.max(0, steps.indexOf(step))
  const go = (to: OnboardingStep) => { setError(null); setStep(to) }
  const next = () => go(steps[Math.min(index + 1, steps.length - 1)])
  const back = index > 0 ? () => go(steps[index - 1]) : null

  // A new step starts at its top, and a screen reader starts at its title.
  const heading = useRef<HTMLHeadingElement>(null)
  const firstPaint = useRef(true)
  useEffect(() => {
    if (firstPaint.current) { firstPaint.current = false; return }
    document.body.scrollTo({ top: 0 })
    window.scrollTo({ top: 0 })
    heading.current?.focus({ preventScroll: true })
  }, [step])

  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v))

  async function saveAbout(e: React.FormEvent) {
    e.preventDefault()
    // Only what was answered: an empty box is not an answer, and must not
    // erase a value already saved in Goals.
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries({
      birthYear: num(birthYear), weightKg: num(weightKg), heightCm: num(heightCm),
    }).filter(([, v]) => v != null))
    if (sex !== undefined) patch.sex = sex
    if (Object.keys(patch).length === 0) { next(); return }
    setSaving(true)
    setError(null)
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) { setError("Not saved — try again, or leave it for now."); return }
    next()
  }

  async function saveCycle() {
    if (tracksCycle === null) { next(); return }
    setSaving(true)
    setError(null)
    const res = await fetch("/api/cycle/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tracksCycle ? { enabled: true, lastStart: lastStart || null, contraception } : { enabled: false }),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) { setError("Not saved — try again, or leave it for now."); return }
    next()
  }

  async function connectHealthConnect() {
    setHc("busy")
    const { requestPermissions, syncToServer } = await import("@/lib/health-connect-service")
    const granted = await requestPermissions().catch(() => false)
    if (!granted) { setHc("failed"); return }
    setHc("done")
    // The first month comes over in the background; the dashboard picks it up.
    syncToServer().catch(() => {})
  }

  async function enableNotifications() {
    setNotif("enabling")
    // The phone is registered here, not just asked — a permission with no
    // subscription behind it receives nothing.
    const result = await subscribeWebPush()
    if (result === "unsupported") {
      // The Android shell schedules on the device; only the permission is ours to ask.
      const perm = typeof Notification === "undefined" ? "denied" : await Notification.requestPermission().catch(() => "denied" as const)
      setNotif(perm === "granted" ? "granted" : "denied")
    } else {
      setNotif(result === "subscribed" ? "granted" : "denied")
    }
  }

  async function complete(skipped: boolean, to = skipped ? "/dashboard" : "/dashboard/checkin") {
    if (saving) return
    setSaving(true)
    let ref: string | null = null
    try { ref = localStorage.getItem("eh_referral_code") } catch {}
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true, ...(skipped ? { skipped: true } : {}), ref: ref ?? undefined }),
    }).catch(() => null)
    if (res?.ok && ref) { try { localStorage.removeItem("eh_referral_code") } catch {} }
    router.push(to)
  }

  const titleClass = "text-2xl font-bold tracking-tight text-foreground outline-none"
  const busyIcon = saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />

  return (
    <div className="flex flex-1 flex-col sm:min-h-[38rem] sm:flex-none sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-8 sm:shadow-2xl">
      <TimezoneSync />
      <Header index={index} total={steps.length} onBack={back} />

      <div key={step} className="flex flex-1 flex-col animate-step-in motion-reduce:animate-none">
        {step === "welcome" && (
          <>
            <section>
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/30">
                <Activity className="h-6 w-6 text-white" aria-hidden />
              </div>
              <h1 ref={heading} tabIndex={-1} className={titleClass}>
                {firstName ? `Welcome, ${firstName}` : "Welcome to Emergenthealth"}
              </h1>
              <Lead>
                Emergenthealth puts your days side by side and shows what tends to go with what — from your own data,
                for you.
              </Lead>
              <ul className="mt-6 space-y-4">
                {[
                  { emoji: "📝", title: "Quick to keep up", text: "A morning check-in, a tap for a habit, or just tell Emergy." },
                  { emoji: "🔍", title: "See what goes together", text: "Patterns found in your own days, each checked against chance." },
                  { emoji: "💬", title: "Ask about it", text: "Emergy reads your data and can talk any of it through." },
                ].map(f => (
                  <li key={f.title} className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary/70 text-lg" aria-hidden>{f.emoji}</span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{f.title}</p>
                      <p className="text-sm text-muted-foreground">{f.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {needsHomeScreen && (
                <div className="mt-6">
                  <Callout>
                    <span aria-hidden>📲</span>
                    <span>On iPhone, add the app to your Home Screen first — in Safari tap Share, then Add to Home Screen, and open it from there. Notifications only work that way.</span>
                  </Callout>
                </div>
              )}
            </section>
            <Footer>
              <Button size="lg" className="w-full" onClick={next}>Get started</Button>
              <Button size="lg" variant="ghost" className="w-full text-muted-foreground" onClick={() => complete(true)} disabled={saving}>
                Skip setup
              </Button>
            </Footer>
          </>
        )}

        {step === "patterns" && (
          <>
            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">How it works</p>
              <h1 ref={heading} tabIndex={-1} className={titleClass}>Your days, compared with each other</h1>
              <div className="mt-4"><PatternsStep /></div>
            </section>
            <Footer>
              <Button size="lg" className="w-full" onClick={next}>Continue</Button>
            </Footer>
          </>
        )}

        {step === "about" && (
          <form onSubmit={saveAbout} className="flex flex-1 flex-col">
            <section>
              <h1 ref={heading} tabIndex={-1} className={titleClass}>About you</h1>
              <Lead>Used for your daily water, protein and calorie targets, and for reading body strain.</Lead>
              <div className="mt-6 space-y-5">
                <Choice
                  label="Sex"
                  options={[["female", "Female"], ["male", "Male"], [null, "Rather not say"]] as const}
                  value={sex}
                  onChange={setSex}
                />
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Birth year">
                    <input type="number" inputMode="numeric" min={1900} max={new Date().getFullYear()} placeholder="1990"
                      value={birthYear} onChange={e => setBirthYear(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Weight, kg">
                    <input type="number" inputMode="decimal" min={20} max={400} step="any" placeholder="70"
                      value={weightKg} onChange={e => setWeightKg(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Height, cm">
                    <input type="number" inputMode="numeric" min={50} max={260} placeholder="175"
                      value={heightCm} onChange={e => setHeightCm(e.target.value)} className={inputClass} />
                  </Field>
                </div>
                <PrivacyNote />
              </div>
              {error && <p className="mt-4 text-sm text-red-400" role="alert">{error}</p>}
            </section>
            <Footer>
              <Button type="submit" size="lg" className="w-full" disabled={saving}>{busyIcon}Continue</Button>
            </Footer>
          </form>
        )}

        {step === "cycle" && (
          <>
            <section>
              <h1 ref={heading} tabIndex={-1} className={titleClass}>Track your cycle?</h1>
              <Lead>
                Periods and phases on a page of their own, what each phase tends to bring, and a note on the home
                page two days before the next period.
              </Lead>
              <div className="mt-6 space-y-5">
                <Choice
                  label="Cycle tracking"
                  options={[[true, "Yes, track it"], [false, "No thanks"]] as const}
                  value={tracksCycle ?? undefined}
                  onChange={setTracksCycle}
                />
                {tracksCycle && (
                  <>
                    <Field label="When did your last period start?">
                      <input type="date" max={today || undefined} value={lastStart} onChange={e => setLastStart(e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Contraception">
                      <select value={contraception} onChange={e => setContraception(e.target.value as Contraception)} className={inputClass}>
                        {CONTRACEPTION.map(c => <option key={c} value={c}>{CONTRACEPTION_GUIDE[c].name}</option>)}
                      </select>
                    </Field>
                    <p className="text-xs text-muted-foreground">
                      Cycle length, the pill pack and a heads-up notification are on the Cycle page.
                    </p>
                  </>
                )}
                {tracksCycle === false && (
                  <p className="text-xs text-muted-foreground">It stays out of the menu. Cycle can be turned on later from search.</p>
                )}
                <PrivacyNote />
              </div>
              {error && <p className="mt-4 text-sm text-red-400" role="alert">{error}</p>}
            </section>
            <Footer>
              <Button size="lg" className="w-full" onClick={saveCycle} disabled={saving}>{busyIcon}Continue</Button>
            </Footer>
          </>
        )}

        {step === "connect" && (
          <>
            <section>
              <h1 ref={heading} tabIndex={-1} className={titleClass}>Connect your data</h1>
              <Lead>
                Every source adds days for patterns to work with. None is required — check-ins, habits and mood work
                on their own.
              </Lead>
              {connectError && (
                <div className="mt-4">
                  <Callout tone="warn">
                    {connectError === "strava_closed"
                      ? "Strava isn't open to new accounts yet — it limits how many people a new app can connect until it approves more. Workouts can still be logged by hand on the Training page."
                      : `${connectError === "oura" ? "Oura" : "Strava"} didn't connect. Try again, or later from Settings.`}
                  </Callout>
                </div>
              )}
              <div className="mt-6 flex flex-col gap-2">
                <ConnectRow emoji="💍" name="Oura Ring" hint="Sleep, HRV and readiness — what many patterns are measured against"
                  connected={connections.oura} href="/api/oura/auth?return=onboarding" />
                {native && (
                  <ConnectRow emoji="📱" name="Health Connect" hint="Steps, heart rate, sleep and workouts from this phone"
                    connected={hc === "done"} onClick={connectHealthConnect} busy={hc === "busy"} />
                )}
                {apple && shortcutUrl && !connections.appleHealth ? (
                  <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 text-xl" aria-hidden>🍎</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">Apple Watch &amp; Apple Health</div>
                        <div className="text-xs leading-snug text-muted-foreground">Sleep, steps and heart rate, sent by a shortcut on this iPhone</div>
                      </div>
                    </div>
                    <AppleHealthQuickSetupStandalone shortcutUrl={shortcutUrl} />
                  </div>
                ) : (apple || connections.appleHealth) && (
                  <ConnectRow emoji="🍎" name="Apple Watch & Apple Health"
                    hint="Sleep, steps and heart rate, sent by a shortcut on this iPhone — about 10 minutes to set up"
                    connected={connections.appleHealth} later="After this, in Settings → Data connections" />
                )}
                {connections.stravaOffered && (
                  <ConnectRow emoji="🚴" name="Strava" hint="Workouts, so training days can be set against rest days"
                    connected={connections.strava} href="/api/strava/auth?return=onboarding" />
                )}
                {connections.calendar && (
                  <ConnectRow emoji="📅" name="Google Calendar" hint="Busy days and recurring activities, through your Google sign-in" connected />
                )}
              </div>
              {hc === "failed" && (
                <p className="mt-3 text-xs text-amber-400">Health Connect wasn&apos;t allowed. It can be connected later from Settings.</p>
              )}
            </section>
            <Footer>
              <Button size="lg" className="w-full" onClick={next}>Continue</Button>
            </Footer>
          </>
        )}

        {step === "notify" && (
          <>
            <section>
              <h1 ref={heading} tabIndex={-1} className={titleClass}>Notifications</h1>
              <Lead>With them on, the app can send:</Lead>
              <ul className="mt-5 space-y-3 rounded-xl border border-border bg-card/60 p-4">
                {[
                  { emoji: "🌅", label: "A morning check-in reminder at 7:00 — the hour can be changed in Settings" },
                  { emoji: "🌙", label: "In the evening, a question about that morning's intention — or, with none set, a nudge to write in the journal" },
                  { emoji: "💊", label: "Medication and habit reminders, at the times you give them" },
                  { emoji: "💬", label: "Now and then a note from Emergy when something in your data stands out" },
                ].map(({ emoji, label }) => (
                  <li key={label} className="flex items-start gap-2.5 text-sm">
                    <span className="shrink-0" aria-hidden>{emoji}</span>
                    <span className="text-muted-foreground">{label}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 space-y-3">
                {notif === "granted" && (
                  <Callout tone="ok"><Bell className="mt-0.5 h-4 w-4 shrink-0" />Notifications are on.</Callout>
                )}
                {notif === "denied" && (
                  <Callout tone="warn"><BellOff className="mt-0.5 h-4 w-4 shrink-0" />Not turned on. They can be enabled later in Settings.</Callout>
                )}
                {needsHomeScreen && notif === "idle" && (
                  <Callout>
                    <span aria-hidden>📲</span>
                    <span>On iPhone, notifications work once the app is on your Home Screen: in Safari tap Share, then Add to Home Screen. They can be turned on in Settings from there.</span>
                  </Callout>
                )}
              </div>
            </section>
            <Footer>
              {!needsHomeScreen && (notif === "idle" || notif === "enabling") && (
                <Button size="lg" className="w-full" disabled={notif === "enabling"} onClick={enableNotifications}>
                  {notif === "enabling" ? "Asking…" : "Turn on notifications"}
                </Button>
              )}
              <Button size="lg" className="w-full" variant={notif === "granted" ? "default" : "ghost"} onClick={next}>
                {notif === "granted" || notif === "denied" || needsHomeScreen ? "Continue" : "Not now"}
              </Button>
            </Footer>
          </>
        )}

        {step === "done" && (
          <>
            <section>
              <h1 ref={heading} tabIndex={-1} className={titleClass}>You&apos;re set</h1>
              <Lead>What happens from here:</Lead>
              <ol className="mt-6 space-y-0">
                {[
                  { when: "Today", what: "The first check-in: energy, mood and an intention for the day." },
                  {
                    when: `Day ${EARLIEST_TEST_DAY}`,
                    what: `The earliest a pattern can appear — ${MIN_GROUP_DAYS} days with something and ${MIN_GROUP_DAYS} without.`,
                  },
                  {
                    when: `Day ${EARLIEST_CONFIDENT_DAY} on`,
                    what: `Sides can reach ${CONFIDENT_N} days, the size the app treats as enough. Patterns gather on Insights — star one to hear when it firms up or flips.`,
                  },
                ].map((item, i, all) => (
                  <li key={item.when} className="relative flex gap-4 pb-6 last:pb-0">
                    {i < all.length - 1 && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-border" aria-hidden />}
                    <span className={cn("relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2", i === 0 ? "border-primary bg-primary" : "border-border bg-background")} aria-hidden />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{item.when}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">{item.what}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <Footer>
              <Button size="lg" className="w-full" onClick={() => complete(false)} disabled={saving}>
                {busyIcon}Do the first check-in
              </Button>
              <Button size="lg" variant="ghost" className="w-full text-muted-foreground" onClick={() => complete(false, "/dashboard")} disabled={saving}>
                Go to the dashboard
              </Button>
            </Footer>
          </>
        )}
      </div>
    </div>
  )
}
