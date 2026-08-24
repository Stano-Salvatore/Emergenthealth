"use client"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageCircle } from "lucide-react"
import { bubbleAvailability, showBubble, type BubbleAvailability } from "@/lib/native/bubble"

/**
 * Emergy floating over other apps — the chat head.
 *
 * Every state here says which of the three things is true, because they need
 * different actions from the user: the phone is too old, the app build is too
 * old, or bubbles are switched off in Android's settings. "It didn't work"
 * would leave all three looking identical.
 */
export function BubbleCard() {
  const [state, setState] = useState<BubbleAvailability | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

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
    setBusy(true); setError(null); setSent(false)
    const err = await showBubble("Hey 🌱 tap me and we can talk without leaving what you're doing.")
    if (err) setError(err)
    else setSent(true)
    setBusy(false)
  }

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
        ) : !state.allowed ? (
          <p className="text-xs text-amber-400">
            Bubbles are switched off for Emergenthealth. Android Settings → Apps →
            Emergenthealth → Notifications → Bubbles.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Emergy floats over whatever you&apos;re doing. Tap him and the chat opens in a
            small window — no leaving the app you&apos;re in.
          </p>
        )}

        <Button size="sm" variant="outline" onClick={tryIt} disabled={busy || !state.available}>
          {busy ? "…" : "Show him"}
        </Button>

        {sent && (
          <p className="text-xs text-muted-foreground">
            Sent. If no bubble appeared, Android is showing it as a normal notification —
            tap and hold it to allow bubbles.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </CardContent>
    </Card>
  )
}
