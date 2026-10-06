"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Check, Copy, Loader2, Play } from "lucide-react"
import { copyText } from "@/lib/utils"

// Apple Watch / Apple Health for an iPhone, through the Shortcuts app.
//
// Apple lets only native iPhone apps read Apple Health, and this one is a web
// app there. So a shortcut on the iPhone reads it and posts it to
// /api/sync/apple-health (lib/apple-health). This card makes the key the
// shortcut sends, walks through building the shortcut, and shows what the
// last run actually saved — the only way to tell from here whether it works.

interface LastSync {
  at: string
  date: string
  saved: Record<string, number | string>
  kept?: string[]
  ignored?: string[]
}

interface Status {
  hasKey: boolean
  hint: string | null
  createdAt: string | null
  lastUsedAt: string | null
  lastSync: LastSync | null
}

const SHORTCUT_NAME = "Emergenthealth"

const LABEL: Record<string, string> = {
  steps: "steps", sleepDuration: "sleep", deepSleep: "deep sleep", remSleep: "REM",
  restingHR: "resting HR", hrv: "HRV", weight: "weight", activeMinutes: "exercise", caloriesBurned: "active energy",
  sleep: "sleep", exerciseMinutes: "exercise", activeEnergy: "active energy",
}

function describeSaved(saved: Record<string, number | string>): string {
  const parts: string[] = []
  const n = (k: string) => (typeof saved[k] === "number" ? (saved[k] as number) : null)
  const sleep = n("sleepDuration")
  if (sleep != null) parts.push(`sleep ${Math.floor(sleep / 60)} h ${sleep % 60} min`)
  if (n("steps") != null) parts.push(`${n("steps")!.toLocaleString()} steps`)
  if (n("restingHR") != null) parts.push(`resting HR ${n("restingHR")}`)
  if (n("hrv") != null) parts.push(`HRV ${n("hrv")} ms`)
  if (n("weight") != null) parts.push(`${n("weight")} kg`)
  if (n("activeMinutes") != null) parts.push(`${n("activeMinutes")} min exercise`)
  if (n("caloriesBurned") != null) parts.push(`${n("caloriesBurned")} kcal active`)
  return parts.join(", ")
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-secondary/50 px-3 py-2 font-mono text-[11px] select-all">{value}</code>
        <button
          type="button"
          onClick={async () => { if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 1800) } }}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-2.5">
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">{n}</span>
    <div className="min-w-0 space-y-1 text-xs leading-relaxed text-muted-foreground">{children}</div>
  </li>
)
const A = ({ children }: { children: React.ReactNode }) => <strong className="font-medium text-foreground">{children}</strong>
const C = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-secondary/60 px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>

export function AppleHealthManager() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")

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

  useEffect(() => {
    setOrigin(window.location.origin)
    void load()
  }, [load])

  async function makeKey() {
    if (status?.hasKey && !confirm("Make a new key? The shortcut stops working until its key is replaced with the new one.")) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/apple-health/key", { method: "POST" })
      const data = await res.json().catch(() => null) as { key?: string } | null
      if (!res.ok || !data?.key) throw new Error()
      setNewKey(data.key)
      await load()
    } catch {
      setError("Couldn't make a key — try again.")
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Apple Health? The shortcut's key stops working. Data already sent stays.")) return
    setBusy(true)
    try {
      await fetch("/api/apple-health/key", { method: "DELETE" })
      setNewKey(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const url = `${origin}/api/sync/apple-health`
  const last = status?.lastSync ?? null
  const fmt = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  const ignored = (last?.ignored ?? []).map(k => LABEL[k] ?? k)
  const kept = (last?.kept ?? []).map(k => LABEL[k] ?? k)

  return (
    <Card id="apple-health" className={last ? "border-green-500/20 bg-green-500/5" : "border-border/50"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <span aria-hidden>🍎</span> Apple Watch &amp; Apple Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Apple lets only iPhone apps read Apple Health, and this app runs in Safari. So a shortcut in the
          iPhone&apos;s <A>Shortcuts</A>{" "}app reads it and sends it here — sleep, steps, resting heart rate and HRV.
          It&apos;s set up once on the iPhone and takes about 10 minutes.
        </p>

        {loadFailed && <p className="text-xs text-amber-400">Couldn&apos;t load the connection&apos;s status. Reload to try again.</p>}

        {status && (
          <div className="rounded-xl border border-border bg-card/60 p-3 space-y-1.5" role="status">
            {last ? (
              <>
                <p className="text-xs text-foreground">
                  Last received {fmt(last.at)}{describeSaved(last.saved) ? `: ${describeSaved(last.saved)}` : ""}.
                </p>
                {kept.length > 0 && <p className="text-[11px] text-muted-foreground">The ring&apos;s readings stand for {kept.join(", ")}.</p>}
                {ignored.length > 0 && (
                  <p className="text-[11px] text-amber-400">
                    Couldn&apos;t read: {ignored.join(", ")}.
                    {ignored.includes("sleep") && " Format the sleep times as ISO 8601 (step 4)."}
                  </p>
                )}
              </>
            ) : status.hasKey ? (
              <p className="text-xs text-muted-foreground">Nothing received yet. Run the shortcut once to test it — what arrives shows here.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Not set up.</p>
            )}
          </div>
        )}

        {newKey ? (
          <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <CopyField label="Your key — shown only now. Copy it into the shortcut (step 5)." value={`Bearer ${newKey}`} />
            <p className="text-[11px] text-muted-foreground">Lost it later? Make a new one here and paste that instead.</p>
          </div>
        ) : status?.hasKey ? (
          <p className="text-[11px] text-muted-foreground">
            Key ending …{status.hint}{status.createdAt ? `, made ${new Date(status.createdAt).toLocaleDateString()}` : ""}. It is shown only when made.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={status?.hasKey ? "outline" : "default"} onClick={makeKey} disabled={busy || !status}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {status?.hasKey ? "Make a new key" : "Create my key"}
          </Button>
          {status?.hasKey && (
            <>
              <Button size="sm" variant="outline" asChild>
                <a href={`shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`}><Play className="h-3.5 w-3.5 mr-1.5" />Send now</a>
              </Button>
              <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy} className="text-muted-foreground">Disconnect</Button>
            </>
          )}
        </div>
        {error && <p className="text-xs text-red-400" role="alert">{error}</p>}

        <details className="group rounded-xl border border-border p-3" open={!last}>
          <summary className="cursor-pointer text-xs font-medium text-foreground">How to set up the shortcut</summary>
          <ol className="mt-3 space-y-3">
            <Step n={1}>
              <p>On the iPhone, open <A>Shortcuts</A>, tap <A>+</A>, and name the shortcut <C>{SHORTCUT_NAME}</C>. Add each action below with the search bar at the bottom.</p>
            </Step>
            <Step n={2}>
              <p><A>Steps.</A> Add <A>Find Health Samples</A>: Type <C>Steps</C>, filter <C>Start Date is today</C>. Add the filter <C>Source is</C> your Apple Watch, so the phone&apos;s steps aren&apos;t counted twice.</p>
              <p>Then <A>Calculate Statistics</A> → <C>Sum</C>, then <A>Set Variable</A> named <C>Steps</C>.</p>
            </Step>
            <Step n={3}>
              <p><A>Heart.</A> <A>Find Health Samples</A>: Type <C>Resting Heart Rate</C>, filter <C>Start Date is in the last 1 day</C> → <A>Calculate Statistics</A> <C>Average</C> → <A>Set Variable</A> <C>RestingHR</C>.</p>
              <p>The same again with Type <C>Heart Rate Variability</C> → <C>Average</C> → <C>HRV</C>.</p>
            </Step>
            <Step n={4}>
              <p><A>Sleep.</A> <A>Find Health Samples</A>: Type <C>Sleep Analysis</C>, filter <C>End Date is today</C>, plus <C>Value is not In Bed</C> and <C>Value is not Awake</C> → <A>Set Variable</A> <C>Sleep</C>.</p>
              <p>Then <A>Get Details of Health Samples</A> → <C>Start Date</C> of <C>Sleep</C> → <A>Set Variable</A> <C>SleepStarts</C>. Again with <C>End Date</C> → <C>SleepEnds</C>.</p>
            </Step>
            <Step n={5}>
              <p><A>Send.</A> Add <A>Get Contents of URL</A> with this URL, tap <A>Show More</A>, set Method to <C>POST</C>:</p>
              {origin && <CopyField label="URL" value={url} />}
              <p>Under <A>Headers</A>, add <C>Authorization</C> with your key as the value — it starts with <C>Bearer ah_</C>.</p>
              <p>Set <A>Request Body</A> to <C>JSON</C> and add these fields, each set to its variable:</p>
              <ul className="ml-4 list-disc space-y-0.5">
                <li><C>steps</C> (Number) → Steps</li>
                <li><C>restingHR</C> (Number) → RestingHR</li>
                <li><C>hrv</C> (Number) → HRV</li>
                <li><C>sleepStarts</C> (Text) → SleepStarts — tap the variable, set <A>Date Format</A> to <C>ISO 8601</C></li>
                <li><C>sleepEnds</C> (Text) → SleepEnds — the same</li>
              </ul>
            </Step>
            <Step n={6}>
              <p><A>Test.</A> Tap ▶ to run it once and allow access to Health when asked. &ldquo;Last received&rdquo; above should show what arrived.</p>
            </Step>
            <Step n={7}>
              <p><A>Make it automatic.</A> In Shortcuts, open <A>Automation</A> → <A>+</A> → <A>Time of Day</A>, e.g. 9:30 daily, choose <A>Run Immediately</A>, and pick <C>{SHORTCUT_NAME}</C>. Add a second one at about 22:00 for the day&apos;s full steps.</p>
              <p>Apple Health can&apos;t be read while the iPhone is locked, so pick times the phone is usually in use. If &ldquo;Last received&rdquo; stops moving, use the trigger <A>App → Is Opened</A> with an app opened every day instead.</p>
            </Step>
          </ol>
        </details>
      </CardContent>
    </Card>
  )
}
