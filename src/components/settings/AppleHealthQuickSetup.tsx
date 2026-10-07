"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Check, ExternalLink, Loader2, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { isAppleMobile } from "@/lib/web-push"
import { readLocalString, useClientValue, useLocalSetting } from "@/lib/use-client-value"
import { SHORTCUT_NAME, connectShortcutUrl } from "@/lib/apple-shortcut"

// Connecting an iPhone with the shared shortcut, in as few taps as Apple
// allows: add the shortcut, tap Connect, make it automatic.
//
// Connect makes a key and opens shortcuts://run-shortcut with the key as the
// input. The shared shortcut saves it to a file and every later run reads it
// from there, so nothing is copied or pasted. Only the automation is by hand:
// iOS has no way for anything to create one. The status endpoint is the check
// that a run arrived — Shortcuts can't hand an answer back to a Home Screen
// web app (x-success opens Safari), so the card asks the server instead.

export interface LastSync {
  at: string
  date: string
  saved: Record<string, number | string>
  kept?: string[]
  ignored?: string[]
  /** The run also stored where the phone was. */
  location?: boolean
}

export interface LastError {
  at: string
  error: string
  ignored?: string[]
}

export interface AppleHealthStatus {
  hasKey: boolean
  hint: string | null
  createdAt: string | null
  lastUsedAt: string | null
  lastSync: LastSync | null
  /** The last run that saved nothing, and why — Shortcuts itself doesn't show it. */
  lastError: LastError | null
}

export function useAppleHealthStatus() {
  const [status, setStatus] = useState<AppleHealthStatus | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/apple-health/key", { cache: "no-store" })
      if (!res.ok) throw new Error()
      setStatus(await res.json())
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  return { status, loadFailed, load }
}

const ADDED = "apple_health_shortcut_added"
const AUTOMATED = "apple_health_automation_done"
// Server time against the phone's: a minute's slack either way.
const SLACK_MS = 60_000
const POLL_MS = 3_000
const POLL_FOR_MS = 3 * 60_000
// Long enough for the permission prompts; after that, say what to check.
const QUIET_MS = 45_000

const A = ({ children }: { children: React.ReactNode }) => <strong className="font-medium text-foreground">{children}</strong>

function QuickStep({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className={cn(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        done ? "bg-green-500/20 text-green-400" : "bg-primary/15 text-primary",
      )}>
        {done ? <Check className="h-3 w-3" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
        <p className={cn("font-medium", done ? "text-muted-foreground" : "text-foreground")}>{title}</p>
        {children}
      </div>
    </li>
  )
}

const writeLocal = (key: string, value: string) => {
  try { localStorage.setItem(key, value) } catch { /* private mode: it's a hint, not a record */ }
}

/** The quick setup on its own, for onboarding: it fetches its own status. */
export function AppleHealthQuickSetupStandalone({ shortcutUrl }: { shortcutUrl: string }) {
  const { status, loadFailed, load } = useAppleHealthStatus()
  return (
    <>
      {loadFailed && <p className="text-xs text-amber-400">Couldn&apos;t load the connection&apos;s status. Reload to try again.</p>}
      <AppleHealthQuickSetup shortcutUrl={shortcutUrl} status={status} reload={load} />
    </>
  )
}

export function AppleHealthQuickSetup({ shortcutUrl, status, reload }: {
  shortcutUrl: string
  status: AppleHealthStatus | null
  reload: () => Promise<void>
}) {
  const onIphone = useClientValue(() => isAppleMobile(), false)
  const [added, setAdded] = useLocalSetting(() => readLocalString(ADDED, "") === "1", false)
  const [automated, setAutomated] = useLocalSetting(() => readLocalString(AUTOMATED, "") === "1", false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** When Connect was tapped: only runs after it count as its answer. */
  const [connectAt, setConnectAt] = useState<number | null>(null)
  const [connectHref, setConnectHref] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const since = (iso: string | undefined) => !!iso && connectAt != null && Date.parse(iso) >= connectAt - SLACK_MS
  const last = status?.lastSync ?? null
  const connected = connectAt != null ? since(last?.at) : !!last
  const lastErr = status?.lastError ?? null
  const failed = connectAt != null && lastErr && since(lastErr.at) && (!connected || lastErr.at > (last?.at ?? "")) ? lastErr : null
  const waiting = connectAt != null && !connected && !failed

  // Waiting on the first run: ask again every few seconds, and the moment the
  // app is back on screen — that is when the run has just finished.
  useEffect(() => {
    if (!waiting) return
    const tick = () => {
      setNow(Date.now())
      if (connectAt != null && Date.now() - connectAt < POLL_FOR_MS) void reload()
    }
    const id = setInterval(tick, POLL_MS)
    const onVisible = () => { if (document.visibilityState === "visible") tick() }
    document.addEventListener("visibilitychange", onVisible)
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible) }
  }, [waiting, connectAt, reload])

  function markAdded() {
    writeLocal(ADDED, "1")
    setAdded(true)
  }

  function markAutomated() {
    writeLocal(AUTOMATED, "1")
    setAutomated(true)
  }

  async function connect() {
    if (status?.hasKey && !confirm("Connect again? This makes a new key and hands it to the shortcut. A shortcut you built by hand stops working until the new key is pasted into it.")) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/apple-health/key", { method: "POST" })
      const data = await res.json().catch(() => null) as { key?: string } | null
      if (!res.ok || !data?.key) throw new Error()
      const href = connectShortcutUrl(data.key)
      setConnectHref(href)
      setConnectAt(Date.now())
      setNow(Date.now())
      await reload()
      // Straight into Shortcuts. If iOS holds it back because the tap was a
      // moment ago, the link below is a tap of its own.
      window.location.href = href
    } catch {
      setError("Couldn't connect — try again.")
    } finally {
      setBusy(false)
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  const quiet = waiting && connectAt != null && now - connectAt > QUIET_MS

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <p className="text-xs font-medium text-foreground">Set up in about a minute</p>
      {!onIphone && (
        <p className="text-[11px] text-amber-400">Open this page on the iPhone that has Apple Health — the shortcut runs there.</p>
      )}
      <ol className="space-y-4">
        <QuickStep n={1} done={added || connected} title="Add the shortcut">
          <p>Opens Shortcuts. Tap <A>Add Shortcut</A>, then come back here. Keep its name, <A>{SHORTCUT_NAME}</A> — Connect finds it by that name.</p>
          <Button size="sm" variant={added || connected ? "outline" : "default"} asChild>
            <a href={shortcutUrl} target="_blank" rel="noopener noreferrer" onClick={markAdded}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />Add the shortcut
            </a>
          </Button>
        </QuickStep>

        <QuickStep n={2} done={connected} title="Connect">
          {connected && last ? (
            <p className="text-green-400">Connected — first data arrived {fmt(last.at)}.</p>
          ) : (
            <>
              <p>
                Runs the shortcut once with your key, so there&apos;s nothing to paste. Say yes to what it asks:
                for Health, <A>Turn On All</A> then <A>Allow</A>; for sending, <A>Always Allow</A>; for saving its
                file and for location, <A>Allow</A>. Then come back here.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={added ? "default" : "outline"} onClick={connect} disabled={busy || !status || !onIphone}>
                  {busy || waiting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                  {waiting ? "Waiting for the first run…" : "Connect"}
                </Button>
                {waiting && connectHref && (
                  <a href={connectHref} className="text-[11px] text-primary underline underline-offset-2">Shortcuts didn&apos;t open? Tap here</a>
                )}
              </div>
            </>
          )}
          {error && <p className="text-red-400" role="alert">{error}</p>}
          {failed && <p className="text-amber-400" role="alert">The run reached the app but saved nothing: {failed.error}</p>}
          {quiet && (
            <p className="text-amber-400">
              Nothing has arrived yet. Check that the shortcut is called exactly <A>{SHORTCUT_NAME}</A> (not
              &ldquo;{SHORTCUT_NAME} 1&rdquo;) and that it ran to the end in Shortcuts. Only zeros or nothing from
              Health? Health app → your profile → <A>Apps</A> → <A>Shortcuts</A> → <A>Turn On All</A>.
            </p>
          )}
        </QuickStep>

        <QuickStep n={3} done={automated} title="Make it automatic">
          {automated ? (
            <p>It sends whenever that app opens. Settings → Apple Health shows what each run brought.</p>
          ) : (
            <>
              <p>
                Apple doesn&apos;t let any app set this up, so it&apos;s the one step done by hand — about 30 seconds.
                In Shortcuts: <A>Automation</A> → <A>+</A> → <A>App</A> → choose an app you open morning and
                evening (Clock or Weather, say) → <A>Is Opened</A> → <A>Run Immediately</A> → <A>Next</A> → pick{" "}
                <A>{SHORTCUT_NAME}</A>.
              </p>
              <p className="text-[11px]">Apple Health can&apos;t be read on a locked phone, so it runs when you&apos;re using it, not on a timer.</p>
              <div className="flex flex-wrap gap-2">
                {onIphone && (
                  <Button size="sm" variant="outline" asChild>
                    <a href="shortcuts://"><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open Shortcuts</a>
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={markAutomated} disabled={!connected}>
                  <Check className="h-3.5 w-3.5 mr-1.5" />Done
                </Button>
              </div>
            </>
          )}
        </QuickStep>
      </ol>
    </div>
  )
}
