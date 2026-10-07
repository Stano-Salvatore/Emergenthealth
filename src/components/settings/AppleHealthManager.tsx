"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Check, Copy, Loader2, Play } from "lucide-react"
import { copyText } from "@/lib/utils"
import { isAppleMobile } from "@/lib/web-push"
import { useClientValue } from "@/lib/use-client-value"
import { SHORTCUT_NAME, runShortcutUrl } from "@/lib/apple-shortcut"
import { AppleHealthQuickSetup, useAppleHealthStatus } from "./AppleHealthQuickSetup"

// Apple Watch / Apple Health for an iPhone, through the Shortcuts app.
//
// Apple lets only native iPhone apps read Apple Health, and this one is a web
// app there. So a shortcut on the iPhone reads it and posts it to
// /api/sync/apple-health (lib/apple-health). This card makes the key the
// shortcut sends, walks through building the shortcut, and shows what the
// last run actually saved — the only way to tell from here whether it works.
// With the shared shortcut (APPLE_SHORTCUT_URL) setup is AppleHealthQuickSetup
// instead: no key to copy, and the key controls move under "build it yourself".

const LABEL: Record<string, string> = {
  steps: "steps", sleepDuration: "sleep", sleepStart: "sleep", sleepEnd: "sleep", deepSleep: "deep sleep", remSleep: "REM",
  restingHR: "resting HR", hrv: "HRV", weight: "weight", activeMinutes: "exercise", caloriesBurned: "active energy",
  sleep: "sleep", exerciseMinutes: "exercise", activeEnergy: "active energy", location: "location",
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

/**
 * `shortcutUrl` is the ready-made shortcut's iCloud link (lib/apple-shortcut),
 * when one has been shared: then setting up is add it, tap Connect, automate.
 */
export function AppleHealthManager({ shortcutUrl = null }: { shortcutUrl?: string | null }) {
  const { status, loadFailed, load } = useAppleHealthStatus()
  const [newKey, setNewKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")

  useEffect(() => { setOrigin(window.location.origin) }, [])

  async function makeKey() {
    if (status?.hasKey && !confirm("Make a new key? The shortcut stops working until its key is replaced with the new one — or, with the shared shortcut, until you tap Connect again.")) return
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
    setError(null)
    try {
      const res = await fetch("/api/apple-health/key", { method: "DELETE" })
      if (!res.ok) throw new Error()
      setNewKey(null)
      await load()
    } catch {
      setError("Couldn't disconnect — try again.")
    } finally {
      setBusy(false)
    }
  }

  const url = `${origin}/api/sync/apple-health`
  const last = status?.lastSync ?? null
  const fmt = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  const labels = (keys: string[] | undefined) => [...new Set((keys ?? []).map(k => LABEL[k] ?? k))]
  const ignored = labels(last?.ignored)
  const kept = labels(last?.kept)
  // A failed run after the last good one is the news; one before it is history.
  const failed = status?.lastError && (!last || status.lastError.at > last.at) ? status.lastError : null
  const onIphone = useClientValue(() => isAppleMobile(), false)

  const keyInfo = newKey ? (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <CopyField label="Your key — shown only now. Copy it into the shortcut (step 5)." value={`Bearer ${newKey}`} />
      <p className="text-[11px] text-muted-foreground">Lost it later? Make a new one here and paste that instead.</p>
    </div>
  ) : status?.hasKey ? (
    <p className="text-[11px] text-muted-foreground">
      Key ending …{status.hint}{status.createdAt ? `, made ${new Date(status.createdAt).toLocaleDateString()}` : ""}. It is shown only when made.
    </p>
  ) : null
  const makeKeyButton = (
    <Button size="sm" variant={status?.hasKey || shortcutUrl ? "outline" : "default"} onClick={makeKey} disabled={busy || !status}>
      {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
      {status?.hasKey ? "Make a new key" : "Create my key"}
    </Button>
  )
  const actions = status?.hasKey ? (
    <>
      {onIphone && (
        <Button size="sm" variant="outline" asChild>
          <a href={runShortcutUrl()}><Play className="h-3.5 w-3.5 mr-1.5" />Send now</a>
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy} className="text-muted-foreground">Disconnect</Button>
    </>
  ) : null

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
          iPhone&apos;s <A>Shortcuts</A>{" "}app reads it and sends it here — sleep, steps, resting heart rate and HRV, and, if you like, where you are.
          It&apos;s set up once on the iPhone{shortcutUrl ? " — three steps, about a minute" : " and takes about 10 minutes"}.
        </p>

        {loadFailed && <p className="text-xs text-amber-400">Couldn&apos;t load the connection&apos;s status. Reload to try again.</p>}

        {status && (
          <div className="rounded-xl border border-border bg-card/60 p-3 space-y-1.5" role="status">
            {last ? (
              <>
                <p className="text-xs text-foreground">
                  Last received {fmt(last.at)}{(() => {
                    const parts = [describeSaved(last.saved), last.location ? "where you were" : ""].filter(Boolean)
                    return parts.length ? `: ${parts.join(", ")}` : ""
                  })()}.
                </p>
                {kept.length > 0 && <p className="text-[11px] text-muted-foreground">The ring&apos;s readings stand for {kept.join(", ")}.</p>}
                {ignored.length > 0 && (
                  <p className="text-[11px] text-amber-400">
                    Couldn&apos;t read: {ignored.join(", ")}.
                    {ignored.includes("sleep") && " Set the sleep times' Date Format to ISO 8601 with Include ISO 8601 Time on (step 5)."}
                  </p>
                )}
              </>
            ) : null}
            {failed && (
              <p className="text-xs text-amber-400">Run at {fmt(failed.at)} saved nothing: {failed.error}</p>
            )}
            {!last && !failed && (status.hasKey ? (
              <p className="text-xs text-muted-foreground">Nothing received yet. Run the shortcut once to test it — what arrives shows here.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Not set up.</p>
            ))}
          </div>
        )}

        {shortcutUrl ? (
          <>
            <AppleHealthQuickSetup shortcutUrl={shortcutUrl} status={status} reload={load} />
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </>
        ) : (
          <>
            {keyInfo}
            <div className="flex flex-wrap gap-2">{makeKeyButton}{actions}</div>
          </>
        )}
        {error && <p className="text-xs text-red-400" role="alert">{error}</p>}

        <details className="group rounded-xl border border-border p-3" open={!last && !shortcutUrl}>
          <summary className="cursor-pointer text-xs font-medium text-foreground">{shortcutUrl ? "Or build it yourself" : "How to set up the shortcut"}</summary>
          {shortcutUrl && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-muted-foreground">A shortcut built by hand carries the key itself: make one here and paste it in step 5.</p>
              {keyInfo}
              {makeKeyButton}
            </div>
          )}
          <ol className="mt-3 space-y-3">
            <Step n={1}>
              <p>On the iPhone, open <A>Shortcuts</A>, tap <A>+</A>, and name the shortcut exactly <C>{SHORTCUT_NAME}</C> — &ldquo;Send now&rdquo; finds it by that name. Add each action below with the search bar at the bottom.</p>
              <p>The names here are the English ones; on an iPhone in another language, the search finds the same actions under their translated names.</p>
            </Step>
            <Step n={2}>
              <p><A>Steps.</A> Add <A>Find Health Samples</A>: Type <C>Steps</C>, filter <C>Start Date is today</C>. Tap <A>Add Filter</A>, change it to <C>Source</C>, and pick your Apple Watch — otherwise the phone&apos;s and the watch&apos;s steps are counted twice. Set <A>Group By</A> to <C>Day</C> if it&apos;s offered.</p>
              <p>Then <A>Calculate Statistics</A> → <C>Sum</C>, then <A>Set Variable</A> named <C>Steps</C>. (Steps walked without the watch on aren&apos;t counted.)</p>
            </Step>
            <Step n={3}>
              <p><A>Heart.</A> <A>Find Health Samples</A>: Type <C>Resting Heart Rate</C>, filter <C>Start Date is today</C> → <A>Calculate Statistics</A> <C>Average</C> → <A>Set Variable</A> <C>RestingHR</C>.</p>
              <p>The same again with Type <C>Heart Rate Variability</C> → <C>Average</C> → <C>HRV</C>. The watch often writes these later in the day, so the evening run is the one that brings them.</p>
            </Step>
            <Step n={4}>
              <p><A>Sleep.</A> <A>Find Health Samples</A>: Type <C>Sleep Analysis</C> (it may be called <C>Sleep</C>), filter <C>Start Date is in the last 2 days</C>, plus <C>Value is not In Bed</C> and <C>Value is not Awake</C>, with <C>All</C> of the filters true → <A>Set Variable</A> <C>Sleep</C>. The app picks last night out of the two days.</p>
              <p>Then <A>Get Details of Health Samples</A>: tap <A>Health Samples</A> in it and choose the variable <C>Sleep</C>, detail <C>Start Date</C> → <A>Set Variable</A> <C>SleepStarts</C>. Again with <C>End Date</C> → <C>SleepEnds</C>.</p>
            </Step>
            <Step n={5}>
              <p><A>Where you are</A> (optional, for place patterns). Add <A>Get Current Location</A> → <A>Set Variable</A> <C>Location</C>. Allow location when asked, with <A>Precise Location</A> on.</p>
              <p><A>Send.</A> Add <A>Get Contents of URL</A> with this URL, tap <A>Show More</A>, set Method to <C>POST</C>:</p>
              {origin && <CopyField label="URL" value={url} />}
              <p>Under <A>Headers</A>, add <C>Authorization</C> with your key as the value — it starts with <C>Bearer ah_</C>.</p>
              <p>Set <A>Request Body</A> to <C>JSON</C> and add these fields, each set to its variable:</p>
              <ul className="ml-4 list-disc space-y-0.5">
                <li><C>steps</C> (Number) → Steps</li>
                <li><C>restingHR</C> (Number) → RestingHR</li>
                <li><C>hrv</C> (Number) → HRV</li>
                <li><C>sleepStarts</C> (Text) → SleepStarts — tap the variable, set <A>Date Format</A> to <C>ISO 8601</C> and turn on <A>Include ISO 8601 Time</A></li>
                <li><C>sleepEnds</C> (Text) → SleepEnds — the same, time included</li>
                <li><C>lat</C> (Number) → Location, tap it and choose <A>Latitude</A> — only if you added location</li>
                <li><C>lon</C> (Number) → Location → <A>Longitude</A></li>
              </ul>
            </Step>
            <Step n={6}>
              <p><A>Test.</A> For now, add <A>Show Result</A> at the end, with the <C>Contents of URL</C>. Tap ▶.</p>
              <ul className="ml-4 list-disc space-y-0.5">
                <li>When it asks about Health, tap <A>Turn On All</A>, then <A>Allow</A>. Left off, Apple hands over nothing and says nothing.</li>
                <li>When it asks to send to this app&apos;s address, tap <A>Always Allow</A> — an automation can&apos;t answer for you.</li>
              </ul>
              <p>The result should start with <C>{`{"ok":true`}</C>, and &ldquo;Last received&rdquo; above shows what arrived. Anything else says what to change. Once it works, delete <A>Show Result</A>.</p>
              <p>Only zeros? Health app → your profile → <A>Apps</A> → <A>Shortcuts</A> → <A>Turn On All</A>. If sleep is missing, in Settings → Shortcuts (Settings → Apps → Shortcuts on newer iOS) → <A>Advanced</A>, turn on <A>Allow Sharing Large Amounts of Data</A>.</p>
            </Step>
            <Step n={7}>
              <p><A>Make it automatic.</A> Apple Health locks about ten minutes after the iPhone does, so a run on a locked phone finds nothing. Run it when the phone is in use: in Shortcuts, <A>Automation</A> → <A>+</A> → <A>App</A>, choose an app you open a few times a day, morning and evening — Clock or Weather, say, not one open all day, <A>Is Opened</A>, <A>Run Immediately</A>, turn off <A>Notify When Run</A>, and pick <C>{SHORTCUT_NAME}</C>.</p>
              <p>Each run replaces the day with fresher numbers, so a few a day is right.</p>
            </Step>
          </ol>
        </details>

        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground">Built it? Share it, so others only tap Connect</summary>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The shared copy carries no key. Connect hands each person&apos;s key to it, and it keeps the key in a file
            for every later run.
          </p>
          <ol className="mt-2 ml-4 list-decimal space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>In Shortcuts, press and hold <C>{SHORTCUT_NAME}</C> → <A>Duplicate</A>, and open the copy. Your own shortcut stays as it is.</li>
            <li><A>Take the key as input.</A> Tap <A>ⓘ</A> → turn on <A>Show in Share Sheet</A>. In the <A>Receive</A> action that appears at the top, choose only <C>Text</C>, and set <A>If there&apos;s no input</A> to <C>Continue</C>.</li>
            <li><A>Keep it.</A> Under that, add <A>If</A> <C>Shortcut Input</C> <C>has any value</C>, and inside it <A>Save File</A> with <C>Shortcut Input</C>: <A>Ask Where to Save</A> off, subpath <C>Emergenthealth/key.txt</C>, <A>Overwrite If File Exists</A> on.</li>
            <li><A>Read it.</A> After <A>End If</A>, add <A>Get File from Folder</A>: folder <C>Shortcuts</C>, path <C>Emergenthealth/key.txt</C>, <A>Error If Not Found</A> off → <A>Set Variable</A> <C>Key</C>. Then <A>If</A> <C>Key</C> <C>does not have any value</C> → <A>Show Alert</A> <C>Not connected yet — in Emergenthealth, open Settings → Apple Health and tap Connect.</C> → <A>Stop This Shortcut</A>.</li>
            <li>In <A>Get Contents of URL</A>, set the <C>Authorization</C> header to <C>Bearer </C> followed by the <C>Key</C> variable. Your own key must not stay in it — it gives access to your health data.</li>
            <li><A>Say it worked.</A> At the very end, add <A>If</A> <C>Shortcut Input</C> <C>has any value</C> → <A>Show Notification</A> <C>Connected — go back to Emergenthealth.</C> Remove <A>Show Result</A> if it&apos;s still there.</li>
            <li>Tap <A>Share</A> → <A>Copy iCloud Link</A>, send the link to whoever runs the app, then delete the copy.</li>
          </ol>
          <p className="mt-2 text-[11px] text-muted-foreground">The app offers it to everyone once the link is set as <C>APPLE_SHORTCUT_URL</C>.</p>
        </details>
      </CardContent>
    </Card>
  )
}
