"use client"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageCircle } from "lucide-react"
import {
  bubbleAvailability,
  bubbleOutcome,
  headStatus,
  openBubbleSettings,
  requestOverlayPermission,
  showBubble,
  startHead,
  stopHead,
  type BubbleAvailability,
  type HeadStatus,
} from "@/lib/native/bubble"

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<"floated" | "notification" | "unknown" | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [a, h] = await Promise.all([bubbleAvailability(), headStatus()])
      if (cancelled) return
      setState(a)
      setHead(h)
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
              tap to talk, and the notification he leaves has a Stop button.
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
          </div>
        ) : null}

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
