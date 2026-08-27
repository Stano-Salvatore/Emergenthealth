"use client"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageCircle } from "lucide-react"
import {
  bubbleAvailability,
  bubbleOutcome,
  headPopCount,
  headPopsEnabled,
  headStatus,
  openBubbleSettings,
  registerNativePush,
  requestOverlayPermission,
  scheduleHeadPops,
  setHeadPopsEnabled,
  setNativePopsEnabled,
  showBubble,
  startHead,
  stopHead,
  testHeadPop,
  type BubbleAvailability,
  type HeadStatus,
} from "@/lib/native/bubble"
import { resyncNotifications } from "@/lib/native/notifications"

/**
 * Emergy floating over other apps.
 *
 * Two different mechanisms live here, and the difference is the whole point.
 *
 * The chat head is a window this app draws — what Messenger has always done,
 * what people mean by "chat head", and the only one that works on a phone
 * whose Android build has no Bubbles support (Samsung's One UI, for one). It
 * costs the "display over other apps" permission, which nobody gets by
 * accident: it can only be switched on by hand in Settings.
 *
 * A bubble is a notification the system may choose to float. It needs no
 * special permission, so it stays as the lighter option for phones that
 * support it — but it is not the thing that pops out of the screen, and this
 * card no longer implies that it is.
 */
export function BubbleCard() {
  const [state, setState] = useState<BubbleAvailability | null>(null)
  const [head, setHead] = useState<HeadStatus | null>(null)
  const [headKnown, setHeadKnown] = useState(false)
  const [pops, setPops] = useState(false)
  const [popsBusy, setPopsBusy] = useState(false)
  const [testNote, setTestNote] = useState<string | null>(null)
  const [popsSet, setPopsSet] = useState<number | "unavailable" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<"floated" | "notification" | "unknown" | null>(null)
  // Whether anything can reach this app while it is closed. The card above
  // says the phone CAN float a window; this says whether a message ever
  // arrives to make it. Both have to be true and only one of them was.
  const [reach, setReach] = useState<Awaited<ReturnType<typeof registerNativePush>> | null>(null)
  const [reachBusy, setReachBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // registerNativePush is idempotent — it re-sends the token, which is
      // what you want anyway since it changes on reinstall — so asking here
      // both reports the state and repairs it where it can be repaired.
      const [a, h, r] = await Promise.all([bubbleAvailability(), headStatus(), registerNativePush()])
      if (cancelled) return
      setState(a)
      setHead(h)
      setReach(r)
      setPops(headPopsEnabled())
      setHeadKnown(true)
    })()
    return () => { cancelled = true }
  }, [])

  // Web has no floating anything, and never will; saying so on a laptop is noise.
  if (!state || (!state.available && state.sdk === 0)) return null

  async function toggleHead() {
    setBusy(true); setError(null); setResult(null)
    if (head?.running) {
      await stopHead()
    } else {
      const err = await startHead()
      if (err) setError(err)
    }
    setHead(await headStatus())
    setBusy(false)
  }

  /**
   * Switching this on has to lay the alarms down now.
   *
   * The app's own re-sync is throttled to once every 30 minutes, so "reopen
   * the app" was not a reliable instruction — reopen it a minute later and
   * nothing would happen, with no way to tell that from a broken feature.
   * This calls the sync directly and then says how many are armed.
   */
  async function togglePops(on: boolean) {
    setPops(on)
    setHeadPopsEnabled(on)
    // Also where native code can read it: a push arriving with the app closed
    // has no WebView, so localStorage alone would leave it unable to tell
    // whether popping was wanted.
    await setNativePopsEnabled(on)
    setPopsSet(null)
    if (!on) { await scheduleHeadPops([]); return }
    setPopsBusy(true)
    try {
      await resyncNotifications()
      const n = await headPopCount()
      setPopsSet(n === null ? "unavailable" : n)
    } catch {
      setPopsSet("unavailable")
    }
    setPopsBusy(false)
  }

  async function grantOverlay() {
    await requestOverlayPermission()
    // The permission is granted on another screen, so nothing here can await
    // it. Re-read on the way back rather than assuming it worked.
    setHead(await headStatus())
  }

  async function tryBubble() {
    setBusy(true); setError(null); setResult(null)
    const err = await showBubble("Hey 🌱 tap me and we can talk without leaving what you're doing.")
    if (err) {
      setError(err)
      setBusy(false)
      return
    }
    // The system sets the bubble flag as it posts, so reading it back in the
    // same tick races the post. A short wait, then the phone's own answer.
    await new Promise(r => setTimeout(r, 900))
    const outcome = await bubbleOutcome()
    setResult(outcome === null ? "unknown" : outcome.bubbled ? "floated" : "notification")
    setState(await bubbleAvailability())
    setBusy(false)
  }

  const pref = state.preference

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Emergy floating</p>
        </div>

        {/* The chat head — the one that actually pops out of the screen. */}
        {headKnown && head === null ? (
          <p className="text-xs text-muted-foreground">
            The chat head needs a newer version of the app than this one.
          </p>
        ) : head ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">Chat head.</span> Emergy sits on
              top of whatever you&apos;re doing, like a Messenger bubble. Drag him anywhere,
              tap to talk, and drag him onto the ✕ at the bottom to put him away. The
              notification he leaves has a Stop button too.
            </p>
            {!head.granted && (
              <p className="text-xs text-amber-400">
                Needs permission to draw over other apps. Android only lets you switch that
                on by hand — this opens the exact screen.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {head.granted ? (
                <Button size="sm" onClick={toggleHead} disabled={busy}>
                  {busy ? "…" : head.running ? "Put him away" : "Float Emergy"}
                </Button>
              ) : (
                <Button size="sm" onClick={grantOverlay}>Allow it</Button>
              )}
            </div>

            {head.granted && typeof popsSet === "number" && popsSet > 0 && (
              <div className="space-y-1 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setTestNote(await testHeadPop(12) ?? "Set. Leave this app now — he should appear in about 12 seconds.")
                  }}
                >
                  Test it in 12s
                </Button>
                {testNote && <p className="text-xs text-muted-foreground">{testNote}</p>}
              </div>
            )}

            {head.granted && (
              <label className="flex items-start gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary"
                  checked={pops}
                  onChange={e => { void togglePops(e.target.checked) }}
                />
                <span className="text-xs text-muted-foreground">
                  Let reminders pop him out. He appears over whatever you&apos;re doing and says
                  the reminder, then clears himself after a few seconds.
                  {popsBusy && <span className="text-foreground"> Setting the alarms…</span>}
                  {!popsBusy && popsSet === "unavailable" && (
                    <span className="text-amber-400">
                      {" "}This app build can&apos;t arm them — install the latest APK.
                    </span>
                  )}
                  {!popsBusy && typeof popsSet === "number" && (
                    <span className={popsSet === 0 ? "text-amber-400" : "text-foreground"}>
                      {" "}{popsSet === 0
                        ? "Nothing armed — you have no reminders or nudges with a time on them."
                        : `${popsSet} armed.`}
                    </span>
                  )}
                </span>
              </label>
            )}
          </div>
        ) : null}

        {/* Whether a message sent while the app is closed arrives at all.
            Every state below was already distinguished by registerNativePush
            and then thrown away by its only caller, so a phone that could
            float a window but could never be told to looked identical to one
            that was working. */}
        {reach && reach !== "off-device" && (
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">Reaching him when the app is closed.</span>{" "}
              {reach === "registered" && (
                <span className="text-emerald-400">
                  Registered. Messages sent while the app is shut arrive here directly, and can pop him out.
                </span>
              )}
              {reach === "not-configured" && (
                <span className="text-amber-400">
                  This phone is registered, but the server has no Firebase set up — so nothing is sent
                  this way yet, and Emergy&apos;s messages arrive through the browser instead.
                </span>
              )}
              {reach === "unreachable" && (
                <span className="text-amber-400">
                  This phone is ready, but registering it didn&apos;t reach the server just now.
                  Try again in a moment.
                </span>
              )}
              {reach === "no-token" && (
                <span className="text-amber-400">
                  This build has no Firebase in it, so the app can&apos;t be reached directly. Emergy&apos;s
                  messages still arrive — through the browser — but a browser notification can&apos;t
                  pop him out, however the settings above are set.
                </span>
              )}
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={reachBusy}
              onClick={async () => {
                setReachBusy(true)
                try { setReach(await registerNativePush()) } finally { setReachBusy(false) }
              }}
            >
              {reachBusy ? "…" : "Check again"}
            </Button>
          </div>
        )}

        <div className="border-t border-border pt-3 space-y-2">
          {/* The bubble — kept, but no longer described as the pop-out. */}
          <p className="text-xs text-muted-foreground">
            <span className="text-foreground font-medium">Bubble.</span>{" "}
            {!state.available
              ? `Android's own bubbles need version 11 or newer — this phone is on API ${state.sdk}.`
              : pref === "none"
                ? "Switched off for Emergenthealth, so nothing will float."
                : pref === "selected"
                  ? "Android floats only conversations you've picked. Send one, then tap and hold the notification and choose to bubble it."
                  : "A notification the system floats on its own. No extra permission — but many phones, Samsung's included, don't support it at all."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={tryBubble} disabled={busy || !state.available}>
              {busy ? "…" : "Try a bubble"}
            </Button>
            {state.available && pref !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => { void openBubbleSettings() }}>
                Bubble settings
              </Button>
            )}
          </div>

          {/* What happened, from the phone rather than from us. */}
          {result === "floated" && (
            <p className="text-xs text-emerald-400">It floated.</p>
          )}
          {result === "notification" && (
            <p className="text-xs text-amber-400">
              Android posted it as an ordinary notification rather than floating it. On a
              phone without bubble support that will not change — use the chat head above.
            </p>
          )}
          {result === "unknown" && (
            <p className="text-xs text-muted-foreground">
              Sent. This app build can&apos;t tell whether it floated — check your screen.
            </p>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </CardContent>
    </Card>
  )
}
