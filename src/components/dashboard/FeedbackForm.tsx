"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Check, Lightbulb, Bug, Heart } from "lucide-react"

export type FeedbackType = "suggestion" | "bug" | "praise"

const TYPES: { value: FeedbackType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "suggestion", label: "Suggestion", icon: <Lightbulb className="h-3.5 w-3.5" />, color: "text-yellow-400" },
  { value: "bug", label: "Bug", icon: <Bug className="h-3.5 w-3.5" />, color: "text-red-400" },
  { value: "praise", label: "Love it", icon: <Heart className="h-3.5 w-3.5" />, color: "text-pink-400" },
]

/**
 * The one feedback composer. The desktop's floating button and the Settings
 * card both render it, so a phone (where the floating button is hidden) has
 * the same path to the inbox as a laptop — and neither can drift.
 */
export function FeedbackForm({ autoFocus = false, onSent }: { autoFocus?: boolean; onSent?: () => void }) {
  const [type, setType] = useState<FeedbackType>("suggestion")
  const [message, setMessage] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) setTimeout(() => textareaRef.current?.focus(), 50)
  }, [autoFocus])

  async function submit() {
    if (!message.trim() || state === "sending") return
    setState("sending")
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim(), type }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setState("sent")
      setTimeout(() => {
        setMessage("")
        setType("suggestion")
        setState("idle")
        onSent?.()
      }, 1800)
    } catch {
      // Said out loud: a form that swallows a 429 looks like it sent.
      setState("failed")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {TYPES.map(t => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              type === t.value
                ? "bg-primary/10 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
          >
            <span className={type === t.value ? "text-primary" : t.color}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        value={message}
        onChange={e => { setMessage(e.target.value); if (state === "failed") setState("idle") }}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit()
        }}
        placeholder={
          type === "suggestion" ? "What would make this better?"
          : type === "bug" ? "What went wrong? What did you expect?"
          : "What do you love about the app?"
        }
        rows={4}
        maxLength={2000}
        className="w-full resize-none rounded-xl bg-secondary/40 border border-border px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 transition-colors"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground/50">
          {state === "failed" ? <span className="text-red-400">Didn&apos;t send — try again in a moment.</span> : `${message.length}/2000 · ⌘↵ to send`}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!message.trim() || state === "sending" || state === "sent"}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-all active:scale-95"
        >
          {state === "sent" ? (
            <><Check className="h-3.5 w-3.5" /> Sent!</>
          ) : state === "sending" ? (
            "Sending…"
          ) : (
            <><Send className="h-3.5 w-3.5" /> Send</>
          )}
        </button>
      </div>
    </div>
  )
}
