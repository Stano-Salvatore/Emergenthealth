"use client"

import { useState, useRef, useEffect } from "react"
import { MessageSquarePlus, X, Send, Check, Lightbulb, Bug, Heart } from "lucide-react"

type FeedbackType = "suggestion" | "bug" | "praise"

const TYPES: { value: FeedbackType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "suggestion", label: "Suggestion", icon: <Lightbulb className="h-3.5 w-3.5" />, color: "text-yellow-400" },
  { value: "bug", label: "Bug", icon: <Bug className="h-3.5 w-3.5" />, color: "text-red-400" },
  { value: "praise", label: "Love it", icon: <Heart className="h-3.5 w-3.5" />, color: "text-pink-400" },
]

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>("suggestion")
  const [message, setMessage] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 50)
  }, [open])

  async function submit() {
    if (!message.trim() || state !== "idle") return
    setState("sending")
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim(), type }),
      })
      setState("sent")
      setTimeout(() => {
        setOpen(false)
        setMessage("")
        setType("suggestion")
        setState("idle")
      }, 1800)
    } catch {
      setState("idle")
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-24 left-4 lg:left-auto lg:bottom-6 lg:right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-white shadow-lg shadow-primary/25 hover:bg-primary/90 transition-all active:scale-95"
        aria-label="Send feedback"
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">Suggest</span>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-36 left-4 lg:left-auto lg:bottom-20 lg:right-6 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border bg-card shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
            <p className="text-sm font-semibold">Share your thoughts</p>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-3">
            {/* Type picker */}
            <div className="flex gap-2">
              {TYPES.map(t => (
                <button
                  key={t.value}
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

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={e => setMessage(e.target.value)}
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

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground/50">{message.length}/2000 · ⌘↵ to send</span>
              <button
                onClick={submit}
                disabled={!message.trim() || state !== "idle"}
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
        </div>
      )}
    </>
  )
}
