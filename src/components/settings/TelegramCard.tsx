"use client"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Send } from "lucide-react"

type State = { configured: boolean; linked: boolean; botUsername: string | null }

/**
 * Emergy outside the app.
 *
 * Telegram rather than Messenger for one reason: Messenger needs a Facebook
 * Page, Meta app review and business verification, and WhatsApp charges for
 * pre-approved templates to message anyone outside a 24-hour window —
 * unprompted contact being exactly the thing that was wanted.
 */
export function TelegramCard() {
  const [state, setState] = useState<State | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/telegram/link")
        if (!res.ok) throw new Error()
        const d = await res.json()
        if (!cancelled) setState(d)
      } catch {
        if (!cancelled) setState(null)
      }
    })()
    return () => { cancelled = true }
  }, [nonce])

  async function getCode() {
    setBusy(true); setError(null)
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "Couldn't get a code.")
      setCode(d.code)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get a code.")
    } finally { setBusy(false) }
  }

  async function unlink() {
    if (!window.confirm("Disconnect Telegram? Emergy will stop messaging you there.")) return
    setBusy(true); setError(null)
    try {
      await fetch("/api/telegram/link", { method: "DELETE" })
      setCode(null); setNonce(n => n + 1)
    } finally { setBusy(false) }
  }

  if (!state) return null

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Emergy on Telegram</p>
        </div>

        {!state.configured ? (
          // Says what is missing instead of offering a button that cannot work.
          <p className="text-xs text-muted-foreground">
            Not set up on this server yet — it needs a bot token from Telegram&apos;s
            BotFather in <code className="text-[11px]">TELEGRAM_BOT_TOKEN</code>.
          </p>
        ) : state.linked ? (
          <>
            <p className="text-xs text-muted-foreground">
              Connected. Message Emergy on Telegram like you do here — you can log things
              there too, and he can reach you without the app being open.
            </p>
            <Button size="sm" variant="outline" onClick={unlink} disabled={busy}>
              Disconnect
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Talk to Emergy from your lock screen, and let him reach you there.
              {state.botUsername
                ? <> Open <span className="text-foreground">@{state.botUsername}</span> on Telegram and send it this code.</>
                : <> Open the bot on Telegram and send it this code.</>}
            </p>
            {code ? (
              <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                <p className="font-mono text-lg tracking-widest text-center">{code}</p>
                <p className="text-[11px] text-muted-foreground text-center mt-1">
                  Send <code>/start {code}</code> to the bot. Expires in 15 minutes.
                </p>
              </div>
            ) : (
              <Button size="sm" onClick={getCode} disabled={busy}>
                {busy ? "…" : "Get a code"}
              </Button>
            )}
          </>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </CardContent>
    </Card>
  )
}
