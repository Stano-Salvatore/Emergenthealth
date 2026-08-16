"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Bell, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isNativeApp } from "@/lib/native/geolocation"
import {
  nudgesEnabled,
  setNudgesEnabled,
  resyncNotifications,
  scheduleTestNotification,
  getNotificationPermission,
  ensureNotificationPermission,
  getExactAlarmPermission,
  requestExactAlarmPermission,
  getScheduledStatus,
  diagnoseNotifications,
  runNotificationSelfTest,
  type ScheduledStatus,
  type NotifDiagnosis,
  type SelfTestStep,
} from "@/lib/native/notifications"

type Perm = "granted" | "denied" | "prompt" | "unavailable" | "loading"
type Exact = "granted" | "denied" | "unavailable" | "loading"

export function NotificationNudges() {
  const [inApp, setInApp] = useState(false)
  const [on, setOn] = useState(true)
  const [perm, setPerm] = useState<Perm>("loading")
  const [exact, setExact] = useState<Exact>("loading")
  const [test, setTest] = useState<"idle" | "sending" | "scheduled" | "denied" | "unavailable">("idle")
  const [testDetail, setTestDetail] = useState<string | null>(null)
  const [status, setStatus] = useState<ScheduledStatus | null>(null)
  const [resyncing, setResyncing] = useState(false)
  const [diag, setDiag] = useState<{ reason: NotifDiagnosis; detail: string } | null>(null)
  const [selfTest, setSelfTest] = useState<SelfTestStep[] | null>(null)
  const [selfTesting, setSelfTesting] = useState(false)
  // Two live clocks + one CSS animation = a freeze detector that needs no tap.
  // The pulsing dot is drawn by the compositor and keeps pulsing when JS is
  // dead; the timer counter needs setTimeout; the pump counter needs
  // MessageChannel. A screenshot of this row alone says which layers a phone
  // has frozen — on a device that hung every bounded call twice, with two
  // different clock implementations, nothing that depends on a tap can be
  // trusted to run.
  const [beat, setBeat] = useState({ timer: 0, pump: 0 })

  useEffect(() => {
    isNativeApp().then(async native => {
      setInApp(native)
      if (native) {
        setOn(nudgesEnabled())
        try {
          // In parallel: on a broken build each of these burns its full bridge
          // timeout, and run one after another they held the diagnosis line —
          // the one thing worth reading on a broken build — back by half a
          // minute. It was reachable but never seen.
          const [perm, exact, status, diag] = await Promise.all([
            getNotificationPermission(),
            getExactAlarmPermission(),
            getScheduledStatus(),
            diagnoseNotifications(),
          ])
          setPerm(perm)
          setExact(exact)
          setStatus(status)
          setDiag(diag)
        } catch (err) {
          // Nothing in that batch is supposed to reject — but a card stuck on
          // "loading" forever is how this bug hid the last time something
          // unexpected happened, so never leave the state stranded.
          setPerm("unavailable")
          setDiag({ reason: "bridge-silent", detail: `status check threw: ${err instanceof Error ? err.message : String(err)}` })
        }
      }
    })
  }, [])

  useEffect(() => {
    if (!inApp) return
    const t0 = Date.now()
    const id = setInterval(() => {
      setBeat(b => ({ ...b, timer: Math.round((Date.now() - t0) / 1000) }))
    }, 1000)
    // The pump is a continuous macrotask chain, so it burns CPU while it
    // runs — 90 seconds is plenty to screenshot and costs nothing after.
    let stop = false
    let mc: MessageChannel | null = null
    try {
      mc = new MessageChannel()
      let last = t0
      mc.port1.onmessage = () => {
        if (stop) return
        const now = Date.now()
        if (now - t0 > 90_000) { stop = true; return }
        if (now - last >= 1000) {
          last = now
          setBeat(b => ({ ...b, pump: Math.round((now - t0) / 1000) }))
        }
        mc!.port2.postMessage(0)
      }
      mc.port2.postMessage(0)
    } catch { /* no MessageChannel — the timer clock stands alone */ }
    return () => {
      stop = true
      clearInterval(id)
      if (mc) { mc.port1.onmessage = null; mc.port1.close(); mc.port2.close() }
    }
  }, [inApp])

  // Native-only — the web build can't fire local notifications.
  if (!inApp) return null

  async function enable() {
    setPerm("loading")
    const granted = await ensureNotificationPermission()
    setPerm(granted ? "granted" : "denied")
    if (granted) await resyncNotifications()
    setStatus(await getScheduledStatus())
  }

  async function toggle() {
    const next = !on
    setOn(next)
    setNudgesEnabled(next)
    if (next) {
      const granted = await ensureNotificationPermission()
      setPerm(granted ? "granted" : "denied")
    }
    await resyncNotifications()
    setStatus(await getScheduledStatus())
  }

  async function resync() {
    setResyncing(true)
    await resyncNotifications()
    setStatus(await getScheduledStatus())
    setResyncing(false)
  }

  async function sendTest() {
    setTest("sending")
    try {
      // Every step is now bounded, but the button's state is set from the
      // test's own result first: reading the permission afterwards used to be
      // what left it on "Sending…" forever when the native side never
      // answered.
      const res = await scheduleTestNotification(step => setTestDetail(step))
      setTest(res.status)
      setTestDetail(res.detail ?? null)
      // Same parallelism as on mount — after a failed test is exactly when
      // the diagnosis line is being stared at, so it can't trail by three
      // timeouts.
      const [perm, status, diag] = await Promise.all([
        getNotificationPermission(),
        getScheduledStatus(),
        diagnoseNotifications(),
      ])
      setPerm(perm)
      setStatus(status)
      setDiag(diag)
      if (res.status === "scheduled") setTimeout(() => setTest("idle"), 5000)
    } catch (err) {
      setTest("unavailable")
      setTestDetail(err instanceof Error ? err.message : String(err))
    }
  }

  async function runSelfTest() {
    setSelfTesting(true)
    try {
      setSelfTest(await runNotificationSelfTest())
    } catch (err) {
      setSelfTest([{ step: "self-test", ok: false, ms: 0, detail: err instanceof Error ? err.message : String(err) }])
    }
    setSelfTesting(false)
  }


  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4" /> Phone Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Permission state / enable */}
        {perm === "denied" ? (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
            <p className="text-xs font-medium text-red-400">Notifications are blocked</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Turn them on in Android: Settings → Apps → Emergenthealth → Notifications, then come back and hit &ldquo;Send test&rdquo;.
            </p>
          </div>
        ) : perm === "prompt" || perm === "loading" ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Allow Emergenthealth to send you notifications.</p>
            <Button size="sm" className="shrink-0" disabled={perm === "loading"} onClick={enable}>
              <Bell className="h-3.5 w-3.5 mr-1.5" /> Enable
            </Button>
          </div>
        ) : perm === "unavailable" ? (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 space-y-1">
            <p className="text-xs font-medium text-red-400">
              {diag?.reason === "ok"
                ? "The app is answering inconsistently"
                : diag?.reason === "js-module-missing"
                ? "This web build is missing the notifications code"
                : diag?.reason === "bridge-silent"
                ? "The app isn't answering notification requests"
                : "This app version can't send notifications"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {diag?.reason === "ok"
                // The state that proved every one-word summary a liar: the
                // diagnosis got an answer while the permission read, made at
                // the same moment, got none. Don't pretend to know — point at
                // the instrument that shows each raw call.
                ? "One check says notifications are fine while an identical one gets no answer. Run diagnostics below — it shows every call's real result."
                : diag?.reason === "js-module-missing"
                ? "The app itself is fine — the site failed to load the notifications module. A force-close and reopen usually clears it."
                : diag?.reason === "bridge-silent"
                ? "The notifications component is installed but not responding. A force-close and reopen usually clears it; if not, reinstall the app."
                : "The installed app is missing the notifications component, so nothing can be scheduled on this phone — no reminders, habits or doses, however they're configured. Updating the app fixes it."}
            </p>
            {(diag == null || diag.reason === "plugin-missing-in-app") && (
              // The app never went through Play, so "update the app" has no
              // store button behind it — hand over the actual APK. Opens in
              // the system browser (github.com isn't in allowNavigation),
              // which is where Android wants installs started from anyway.
              <a
                href="https://github.com/Stano-Salvatore/Emergenthealth/releases/latest/download/emergenthealth.apk"
                className="inline-block text-[11px] font-medium text-red-400 underline underline-offset-2"
              >
                Download the current APK
              </a>
            )}
            {diag && (
              <p className="text-[10px] font-mono text-muted-foreground/70 pt-0.5">
                {diag.reason} · {diag.detail}
              </p>
            )}
          </div>
        ) : on && status?.available && status.pending === 0 ? (
          // Permission granted, nudges on, yet nothing is laid down — the
          // state that used to be indistinguishable from everything working.
          // With nudges off an empty queue is intended, and a timed-out
          // getPending is no evidence, so neither triggers the warning.
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 space-y-1.5">
            <p className="text-xs font-medium text-amber-400">
              Notifications are allowed, but nothing is scheduled on this phone
            </p>
            <p className="text-[11px] text-muted-foreground">
              So nothing will buzz. Resync should fix it — if the count stays at zero afterwards,
              this build can&apos;t schedule notifications and the app needs updating.
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={resyncing} onClick={resync}>
              {resyncing ? "Resyncing…" : "Resync now"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-green-400">
            ✓ Notifications are on
            {status?.available ? ` — ${status.pending} scheduled on this phone` : " for this phone"}
            {status?.nextAt ? ` (next: ${new Date(status.nextAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.
          </p>
        )}

        {/* Exact timing. Only worth showing once notifications actually work,
            and only when Android has something left to grant. */}
        {perm === "granted" && exact === "denied" && (
          <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">Reminders arrive within a few minutes</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Android batches them to save battery. Allow exact alarms and 07:30 means 07:30.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={async () => {
                setExact("loading")
                setExact(await requestExactAlarmPermission())
                await resyncNotifications()
                setStatus(await getScheduledStatus())
              }}
            >
              Allow
            </Button>
          </div>
        )}
        {perm === "granted" && exact === "granted" && (
          <p className="text-[11px] text-green-400 border-t border-border/40 pt-3">
            ✓ Exact timing on — reminders fire at the minute you set.
          </p>
        )}

        {/* Daily nudges toggle */}
        <div className="flex items-center justify-between gap-4 border-t border-border/40 pt-3">
          <p className="text-sm text-muted-foreground">
            Daily nudges — morning check-in, hydration (13:00), and habits (20:00).
            The morning time and which of the three you get are set above.
          </p>
          <button
            onClick={toggle}
            role="switch"
            aria-checked={on}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-secondary"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>

        {/* Test */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3">
          <p className="text-xs text-muted-foreground">
            {test === "scheduled" ? "Sent — should appear in ~3s 👀"
              : test === "denied" ? "Blocked — enable notifications first"
              : test === "unavailable" ? "Not supported on this build"
              : "Check it works on this phone"}
          </p>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 shrink-0" disabled={test === "sending"} onClick={sendTest}>
            <Send className="h-3 w-3" />
            {test === "sending" ? "Sending…" : "Send test"}
          </Button>
        </div>
        {testDetail && test !== "idle" && test !== "scheduled" && (
          <p className={`text-[10px] font-mono ${test === "sending" ? "text-muted-foreground" : "text-red-400/80"}`}>{testDetail}</p>
        )}

        {/* Per-call diagnostics. Summaries of this machinery have contradicted
            each other on a real phone, so the escape hatch is no summary at
            all: every raw call, its timing, and what actually came back —
            including a probe notification whose arrival (or not) is the only
            ground truth that matters. */}
        <div className="border-t border-border/40 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Something off? Test every call this phone makes.</p>
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={selfTesting} onClick={runSelfTest}>
              {selfTesting ? "Running…" : "Run diagnostics"}
            </Button>
          </div>
          {selfTest && (
            <div className="rounded-lg bg-secondary/40 px-3 py-2 space-y-1 overflow-x-auto">
              {selfTest.map((s, i) => (
                <p key={i} className={`text-[10px] font-mono whitespace-nowrap ${s.ok ? "text-muted-foreground" : "text-red-400"}`}>
                  {s.ok ? "✓" : "✗"} {s.step} ({s.ms}ms) — {s.detail}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Which web build this phone is actually running. The shell loads its
            code from the server, so "the app is up to date" says nothing about
            the code on screen — and a stale build looks exactly like broken
            notifications. This line answers it from the phone itself, no USB
            debugging needed: compare against the latest deploy's commit. */}
        <p className="text-[10px] font-mono text-muted-foreground/60 border-t border-border/40 pt-2">
          web build {(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "sha unavailable"}
        </p>
        {/* The dot pulses from the compositor even with JS frozen; each
            counter ticks only while its clock lives. Dot pulsing + counters
            stuck = the WebView froze this page's task queues, and nothing any
            web code does will run until the phone unfreezes it. */}
        <p className="text-[10px] font-mono text-muted-foreground/60">
          <span className="inline-block animate-pulse text-green-400">●</span>{" "}
          heartbeat — timer {beat.timer}s · pump {beat.pump}s · WebView{" "}
          {typeof navigator !== "undefined" ? (/Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "?") : "?"}
        </p>
      </CardContent>
    </Card>
  )
}
