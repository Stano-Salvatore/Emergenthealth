"use client"

// The first-run wizard. Every step either saves something the app reads —
// Goals, the cycle settings, a connection, a push subscription — or is
// skippable in one tap; nothing is asked and then thrown away. Skipping the
// whole wizard still records it as done, or the dashboard would send them
// straight back here.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, BellOff, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { iosNeedsHomeScreen, subscribeWebPush } from "@/lib/web-push"
import { isNativeShell } from "@/lib/native/shell"
import { useClientValue } from "@/lib/use-client-value"
import { onboardingSteps, type OnboardingStep } from "@/lib/onboarding-steps"
import { CONTRACEPTION, type Contraception } from "@/lib/cycle"
import { CONTRACEPTION_GUIDE } from "@/lib/cycle-guide"

type Sex = "male" | "female" | null

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "block rounded-full transition-all duration-300 h-2",
            i === current ? "w-4 bg-primary" : i < current ? "w-2 bg-primary" : "w-2 bg-border",
          )}
        />
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

const inputClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"

function ConnectRow({ emoji, name, hint, connected, href, onClick, busy }: {
  emoji: string; name: string; hint: string; connected: boolean
  href?: string; onClick?: () => void; busy?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="text-xl shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground text-sm">{name}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {connected ? (
        <span className="shrink-0 flex items-center gap-1 text-xs text-green-400"><Check className="h-3.5 w-3.5" />Connected</span>
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

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function OnboardingPage() {
  const router = useRouter()
  // Coming back from Oura or Strava lands on ?step=connect, not the welcome.
  const startAt = useClientValue(() => new URLSearchParams(window.location.search).get("step"), null)
  const returned = useClientValue(() => window.location.search, "")
  const needsHomeScreen = useClientValue(() => iosNeedsHomeScreen(), false)
  const native = useClientValue(() => isNativeShell(), false)

  const [picked, setPicked] = useState<OnboardingStep | null>(null)
  const [sex, setSex] = useState<Sex>(null)
  const [birthYear, setBirthYear] = useState("")
  const [weightKg, setWeightKg] = useState("")
  const [heightCm, setHeightCm] = useState("")
  const [tracksCycle, setTracksCycle] = useState<boolean | null>(null)
  const [lastStart, setLastStart] = useState("")
  const [contraception, setContraception] = useState<Contraception>("none")
  const [connections, setConnections] = useState({ oura: false, strava: false })
  const [hc, setHc] = useState<"idle" | "busy" | "done" | "failed">("idle")
  const [notif, setNotif] = useState<"idle" | "enabling" | "granted" | "denied">("idle")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const steps = onboardingSteps({ sex })
  const step: OnboardingStep = picked ?? (startAt === "connect" ? "connect" : "welcome")
  const index = Math.max(0, steps.indexOf(step))
  const next = () => { setError(null); setPicked(steps[Math.min(index + 1, steps.length - 1)]) }
  const back = () => { setError(null); setPicked(steps[Math.max(index - 1, 0)]) }

  // What is already known: someone coming back from a connection, or who set
  // things in Goals before, sees their own answers rather than empty boxes.
  useEffect(() => {
    fetch("/api/goals").then(r => (r.ok ? r.json() : null)).then(g => {
      if (!g) return
      if (g.sex === "male" || g.sex === "female") setSex(g.sex)
      if (g.birthYear != null) setBirthYear(String(g.birthYear))
      if (g.weightKg != null) setWeightKg(String(g.weightKg))
      if (g.heightCm != null) setHeightCm(String(g.heightCm))
    }).catch(() => {})
    fetch("/api/onboarding").then(r => (r.ok ? r.json() : null)).then(o => {
      if (o?.connections) setConnections(o.connections)
    }).catch(() => {})
  }, [])

  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v))

  async function saveAbout() {
    setSaving(true)
    setError(null)
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only what was answered: an empty box is not an answer, and must not
      // erase a value already saved in Goals if the prefill hadn't landed.
      body: JSON.stringify(Object.fromEntries(Object.entries({
        sex, birthYear: num(birthYear), weightKg: num(weightKg), heightCm: num(heightCm),
      }).filter(([, v]) => v != null))),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) { setError("Not saved — try again, or skip this step."); return }
    next()
  }

  async function saveCycle() {
    if (tracksCycle === null) { next(); return }
    setSaving(true)
    setError(null)
    const body = tracksCycle
      ? { enabled: true, lastStart: lastStart || null, contraception }
      : { enabled: false }
    const res = await fetch("/api/cycle/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) { setError("Not saved — try again, or skip this step."); return }
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

  const connectError = /(oura|strava)_error=/.exec(returned)?.[1]

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-2xl bg-card border border-border p-8">
        <StepDots current={index} total={steps.length} />

        {step === "welcome" && (
          <div>
            <div className="text-4xl mb-4">✨</div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Welcome to Emergenthealth</h1>
            <p className="text-muted-foreground mb-6 leading-relaxed">
              A few questions so the app starts from you rather than from defaults. Every one of them is optional.
            </p>
            {needsHomeScreen && (
              <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card/50 px-4 py-3 mb-6">
                On iPhone, add the app to your Home Screen first — in Safari tap Share, then Add to Home Screen, and open it from there. Notifications only work that way.
              </p>
            )}
            <div className="flex flex-col gap-3">
              <Button className="w-full" size="lg" onClick={next}>Get started →</Button>
              <Button variant="ghost" size="lg" className="w-full text-muted-foreground" onClick={() => complete(true)} disabled={saving}>
                Skip setup, take me to the dashboard
              </Button>
            </div>
          </div>
        )}

        {step === "about" && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">About you</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Used for your daily water, protein and calorie targets and for reading body strain. Leave any of it empty.
            </p>
            <div className="space-y-4 mb-8">
              <div>
                <span className="text-xs font-medium text-muted-foreground">Sex</span>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {([["female", "Female"], ["male", "Male"], [null, "Rather not say"]] as const).map(([v, label]) => (
                    <button
                      key={label}
                      onClick={() => setSex(v)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm transition-colors",
                        sex === v ? "border-primary bg-primary text-primary-foreground font-medium" : "border-border text-muted-foreground hover:border-primary/50",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Birth year">
                  <input type="number" inputMode="numeric" min={1900} max={new Date().getFullYear()} placeholder="1990"
                    value={birthYear} onChange={e => setBirthYear(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Weight (kg)">
                  <input type="number" inputMode="decimal" min={20} max={400} placeholder="70"
                    value={weightKg} onChange={e => setWeightKg(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Height (cm)">
                  <input type="number" inputMode="numeric" min={50} max={260} placeholder="175"
                    value={heightCm} onChange={e => setHeightCm(e.target.value)} className={inputClass} />
                </Field>
              </div>
              <p className="text-[11px] text-muted-foreground">All of it can be changed later in Settings, under Goals.</p>
            </div>
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="flex flex-col gap-3">
              <Button className="w-full" size="lg" onClick={saveAbout} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Continue →
              </Button>
              <Button variant="ghost" size="lg" className="w-full text-muted-foreground" onClick={back}>Back</Button>
            </div>
          </div>
        )}

        {step === "cycle" && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">Cycle tracking</h2>
            <p className="text-muted-foreground text-sm mb-6">
              A page for periods and phases, what each phase tends to bring, and a note on the home page two days before the next one.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-6">
              {([[true, "Yes, track it"], [false, "No thanks"]] as const).map(([v, label]) => (
                <button
                  key={label}
                  onClick={() => setTracksCycle(v)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm transition-colors",
                    tracksCycle === v ? "border-primary bg-primary text-primary-foreground font-medium" : "border-border text-muted-foreground hover:border-primary/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {tracksCycle && (
              <div className="space-y-4 mb-6">
                <Field label="When did your last period start?">
                  <input type="date" max={today()} value={lastStart} onChange={e => setLastStart(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Contraception">
                  <select value={contraception} onChange={e => setContraception(e.target.value as Contraception)} className={inputClass}>
                    {CONTRACEPTION.map(c => <option key={c} value={c}>{CONTRACEPTION_GUIDE[c].name}</option>)}
                  </select>
                </Field>
                <p className="text-[11px] text-muted-foreground">
                  Both optional. Cycle length, the pill pack and the heads-up push are on the Cycle page.
                </p>
              </div>
            )}
            {tracksCycle === false && (
              <p className="text-[11px] text-muted-foreground mb-6">The page stays out of the menu. It can be turned on later from Cycle in search.</p>
            )}
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="flex flex-col gap-3">
              <Button className="w-full" size="lg" onClick={saveCycle} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Continue →
              </Button>
              <Button variant="ghost" size="lg" className="w-full text-muted-foreground" onClick={back}>Back</Button>
            </div>
          </div>
        )}

        {step === "connect" && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">Connect your data</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Each one fills in part of the picture on its own. None is required — check-ins, mood and habits work without any.
            </p>
            {connectError && (
              <p className="text-xs text-amber-400 mb-3">
                {`${connectError === "oura" ? "Oura" : "Strava"} didn't connect. Try again, or later from Settings.`}
              </p>
            )}
            <div className="flex flex-col gap-2 mb-8">
              <ConnectRow emoji="💍" name="Oura Ring" hint="Sleep, readiness, HRV, temperature"
                connected={connections.oura} href="/api/oura/auth?return=onboarding" />
              {native && (
                <ConnectRow emoji="📱" name="Health Connect" hint="Steps, heart rate, sleep and workouts from this phone"
                  connected={hc === "done"} onClick={connectHealthConnect} busy={hc === "busy"} />
              )}
              <ConnectRow emoji="🚴" name="Strava" hint="Workouts and activities"
                connected={connections.strava} href="/api/strava/auth?return=onboarding" />
              <ConnectRow emoji="📅" name="Google Calendar" hint="Read through your Google sign-in — nothing to do" connected />
            </div>
            {hc === "failed" && (
              <p className="text-xs text-amber-400 -mt-6 mb-6">Health Connect wasn&apos;t allowed. It can be connected later from Settings.</p>
            )}
            <div className="flex flex-col gap-3">
              <Button className="w-full" size="lg" onClick={next}>Continue →</Button>
              <Button variant="ghost" size="lg" className="w-full text-muted-foreground" onClick={back}>Back</Button>
            </div>
          </div>
        )}

        {step === "notify" && (
          <div>
            <div className="text-4xl mb-4">🔔</div>
            <h2 className="text-xl font-bold text-foreground mb-1">Notifications</h2>
            <p className="text-muted-foreground text-sm mb-6">With them on, the app can send:</p>
            <div className="rounded-xl border border-border bg-card/50 p-4 mb-6 space-y-3">
              {[
                { emoji: "🌅", label: "A morning check-in reminder at 7:00 — the hour is yours to change in Settings" },
                { emoji: "🌙", label: "In the evening, a question about that morning's intention — or, with none set, a nudge to write in the journal" },
                { emoji: "💊", label: "Medication and habit reminders, at the times you give them" },
                { emoji: "💬", label: "Now and then a note from Emergy when something in your data stands out" },
              ].map(({ emoji, label }) => (
                <div key={label} className="flex items-start gap-2.5 text-sm">
                  <span className="shrink-0">{emoji}</span>
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
            {notif === "granted" ? (
              <div className="flex items-center gap-2 rounded-xl bg-green-500/10 border border-green-500/30 px-4 py-3 mb-4">
                <Bell className="h-4 w-4 text-green-400 shrink-0" />
                <p className="text-sm text-green-300 font-medium">Notifications are on.</p>
              </div>
            ) : notif === "denied" ? (
              <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 mb-4">
                <BellOff className="h-4 w-4 text-amber-400 shrink-0" />
                <p className="text-sm text-amber-300">Not turned on. They can be enabled later in Settings.</p>
              </div>
            ) : null}
            <div className="flex flex-col gap-3">
              {needsHomeScreen && notif === "idle" && (
                <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card/50 px-4 py-3">
                  On iPhone, notifications work once the app is on your Home Screen: in Safari tap Share, then Add to Home Screen. They can be turned on in Settings from there.
                </p>
              )}
              {!needsHomeScreen && notif !== "granted" && notif !== "denied" && (
                <Button
                  className="w-full"
                  size="lg"
                  disabled={notif === "enabling"}
                  onClick={async () => {
                    setNotif("enabling")
                    // The phone is registered here, not just asked — a
                    // permission with no subscription behind it receives nothing.
                    const result = await subscribeWebPush()
                    if (result === "unsupported") {
                      // The Android shell schedules on the device; only the permission is ours to ask.
                      const perm = typeof Notification === "undefined" ? "denied" : await Notification.requestPermission().catch(() => "denied" as const)
                      setNotif(perm === "granted" ? "granted" : "denied")
                    } else {
                      setNotif(result === "subscribed" ? "granted" : "denied")
                    }
                  }}
                >
                  {notif === "enabling" ? "Requesting…" : "Turn on notifications"}
                </Button>
              )}
              <Button className="w-full" size="lg" variant={notif === "granted" ? "default" : "outline"} onClick={next}>
                {notif === "granted" ? "Continue →" : "Not now"}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div>
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-foreground mb-2">That&apos;s it</h2>
              <p className="text-muted-foreground leading-relaxed">
                The first check-in takes under a minute and is where most of the app starts.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 divide-y divide-border/40 mb-8">
              {[
                { emoji: "💬", label: "Talk to Emergy", href: "/dashboard/chat", hint: "Ask about your data, or log things by just saying them" },
                { emoji: "✅", label: "Add a habit", href: "/dashboard/habits", hint: "With a reminder time if you want one" },
                { emoji: "🎯", label: "Set goals", href: "/dashboard/settings#goals", hint: "Sleep, steps, water — what the dashboard measures against" },
              ].map(item => (
                <button key={item.href} onClick={() => complete(false, item.href)} disabled={saving}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors">
                  <span className="text-xl shrink-0">{item.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.hint}</p>
                  </div>
                  <span className="text-muted-foreground/40 text-sm">→</span>
                </button>
              ))}
            </div>
            <Button className="w-full" size="lg" onClick={() => complete(false)} disabled={saving}>
              {saving ? "Opening…" : "Do the first check-in →"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
