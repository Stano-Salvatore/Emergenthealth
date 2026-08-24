"use client"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageCircle } from "lucide-react"
import {
  bubbleAvailability,
  bubbleOutcome,
  openBubbleSettings,
  showBubble,
  type BubbleAvailability,
} from "@/lib/native/bubble"

/**
 * Emergy floating over other apps — the chat head.
 *
 * The states here are not decoration. A bubble can fail to float for four
 * different reasons and only one of them is a bug: the phone is too old, the
 * APK predates the feature, bubbles are switched off, or — the common one —
 * Android is set to bubble only conversations you have picked, and nobody has
 * picked this one yet. That last case looks exactly like "broken" and is
 * fixed by one tap on the notification, so it gets its own words.
 */
export function BubbleCard() {
  const [state, setState] = useState<BubbleAvailability | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<"floated" | "notification" | "unknown" | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const a = await bubbleAvailability()
      if (!cancelled) setState(a)
    })()
    return () => { cancelled = true }
  }, [])

  // Web has no bubbles and never will; saying so on a laptop is noise.
  if (!state || (!state.available && state.sdk === 0)) return null

  async function tryIt() {
    setBusy(true); setError(null); setResult(null)
    const err = await showBubble("Hey 🌱 tap me and we can talk without leaving what you're doing.")
    if (err) {
      setError(err)
      setBusy(false)
      return
    }
    // The system sets the bubble flag as it posts, so reading it back
    // immediately races the post. A short wait, then the phone's own answer.
    await new Promise(r => setTimeout(r, 900))
    const outcome = await bubbleOutcome()
    setResult(outcome === null ? "unknown" : outcome.bubbled ? "floated" : "notification")
    // Promoting a conversation changes the app-level answer too; re-read it
    // so the card is not still describing the phone as it was a minute ago.
    setState(await bubbleAvailability())
    setBusy(false)
  }

  const pref = state.preference

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Emergy bubble</p>
        </div>

        {!state.available ? (
          <p className="text-xs text-muted-foreground">
            Floating bubbles need Android 11 or newer — this phone is on API {state.sdk}.
          </p>
        ) : pref === "none" ? (
          <p className="text-xs text-amber-400">
            Bubbles are switched off for Emergenthealth, so nothing will float until
            that changes.
          </p>
        ) : pref === "selected" ? (
          <p className="text-xs text-muted-foreground">
            Android is set to float only conversations you&apos;ve picked. Send one below,
            then <span className="text-foreground">tap and hold the notification</span> and
            choose to bubble it — once, and Emergy floats from then on.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Emergy floats over whatever you&apos;re doing. Tap him and the chat opens in a
            small window — no leaving the app you&apos;re in.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={tryIt} disabled={busy || !state.available}>
            {busy ? "…" : "Show him"}
          </Button>
          {state.available && pref !== "all" && (
            <Button size="sm" variant="ghost" onClick={() => { void openBubbleSettings() }}>
              Open Android&apos;s bubble settings
            </Button>
          )}
        </div>

        {/* What happened, from the phone rather than from us. */}
        {result === "floated" && (
          <p className="text-xs text-emerald-400">He floated. Drag him anywhere, tap to talk.</p>
        )}
        {result === "notification" && (
          <p className="text-xs text-amber-400">
            Android posted him as an ordinary notification instead of floating him. Tap and
            hold it and choose to bubble the conversation, or open the bubble settings above
            and allow all conversations.
          </p>
        )}
        {result === "unknown" && (
          <p className="text-xs text-muted-foreground">
            Sent. This app build can&apos;t tell whether it floated — check your screen.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </CardContent>
    </Card>
  )
}
