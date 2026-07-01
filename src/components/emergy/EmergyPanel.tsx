"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { X, Send, Bell } from "lucide-react"
import { EmergySVG, EmergyState } from "./EmergySVG"

interface EmergyData {
  state: EmergyState
  message: string
  xp: number
  level: number
  levelName: string
  progress: number
  waterMl: number
  habitsDone: number
  totalHabits: number
}

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt?: string
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0))).buffer
}

function getBriefType(): "morning" | "midday" | "evening" | null {
  const h = new Date().getHours()
  if (h >= 6 && h <= 10) return "morning"
  if (h >= 12 && h <= 14) return "midday"
  if (h >= 20 && h <= 22) return "evening"
  return null
}

export function EmergyPanel() {
  const [open, setOpen] = useState(false)
  const [emergy, setEmergy] = useState<EmergyData | null>(null)
  const [brief, setBrief] = useState<string | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | null>(null)
  const [showBubble, setShowBubble] = useState(false)
  const [lastShownMessage, setLastShownMessage] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchEmergy = useCallback(async () => {
    try {
      const res = await fetch("/api/emergy")
      if (res.ok) {
        const data = await res.json()
        setEmergy(data)
        // Update app icon badge with incomplete habit count
        if ("setAppBadge" in navigator) {
          const incomplete = (data.totalHabits ?? 0) - (data.habitsDone ?? 0)
          if (incomplete > 0) {
            navigator.setAppBadge(incomplete).catch(() => {})
          } else {
            navigator.clearAppBadge().catch(() => {})
          }
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    fetchEmergy()
    intervalRef.current = setInterval(fetchEmergy, 5 * 60 * 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchEmergy])

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setNotifPerm(Notification.permission)
    }
  }, [])

  // Show speech bubble when a new message arrives and panel is closed
  useEffect(() => {
    if (!emergy?.message || open || emergy.message === lastShownMessage) return
    setShowBubble(true)
    setLastShownMessage(emergy.message)
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = setTimeout(() => setShowBubble(false), 7000)
    return () => { if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current) }
  }, [emergy?.message, open, lastShownMessage])

  // Hide bubble when panel opens
  useEffect(() => {
    if (open) setShowBubble(false)
  }, [open])

  useEffect(() => {
    if (!open) return

    fetch("/api/chat")
      .then(r => r.json())
      .then((data: ChatMessage[]) => {
        if (Array.isArray(data)) setMessages(data.slice(-50))
      })
      .catch(() => {})

    const briefType = getBriefType()
    if (briefType && !brief) {
      setBriefLoading(true)
      fetch(`/api/emergy/brief?type=${briefType}`)
        .then(r => r.json())
        .then(d => setBrief(d.brief ?? null))
        .catch(() => {})
        .finally(() => setBriefLoading(false))
    }
  }, [open, brief])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function enablePush() {
    if (typeof Notification === "undefined") return
    const perm = await Notification.requestPermission()
    setNotifPerm(perm)
    if (perm !== "granted") return
    try {
      const reg = await navigator.serviceWorker.register("/sw.js")
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) return
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      })
    } catch {}
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return
    setInput("")
    setSending(true)

    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", content: text }
    setMessages(prev => [...prev, userMsg])

    const assistantMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: "assistant", content: "" }
    setMessages(prev => [...prev, assistantMsg])

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      if (!res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6)
          if (data === "[DONE]") break
          try {
            const parsed = JSON.parse(data)
            if (parsed.text) {
              fullText += parsed.text
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, content: fullText } : m
              ))
            }
          } catch {}
        }
      }
    } catch {}

    setSending(false)
    inputRef.current?.focus()
  }

  const state = emergy?.state ?? "okay"
  const isScreaming = emergy?.state === "screaming"

  return (
    <>
      {/* Speech bubble + button row */}
      <div className="fixed bottom-20 lg:bottom-10 right-6 z-50 flex items-center gap-3">
        {/* Speech bubble — appears to the left when Emergy has something to say */}
        {showBubble && emergy?.message && (
          <div
            className="relative max-w-[240px] pointer-events-auto"
            style={{ animation: "emg-bubble-in 0.25s ease-out" }}
          >
            <style>{`
              @keyframes emg-bubble-in {
                from { opacity: 0; transform: translateX(8px) scale(0.96); }
                to   { opacity: 1; transform: translateX(0)   scale(1); }
              }
            `}</style>
            <div className="relative bg-card border border-border rounded-2xl px-3 py-2.5 shadow-xl text-xs leading-relaxed pr-7">
              {emergy.message}
              <button
                onClick={() => setShowBubble(false)}
                aria-label="Dismiss"
                className="absolute top-1.5 right-1.5 w-4 h-4 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            {/* Arrow pointing right toward Emergy */}
            <div
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[5px] rotate-45 w-2.5 h-2.5 bg-card border-r border-b border-border"
              aria-hidden="true"
            />
          </div>
        )}

        {/* Emergy button — icon only, no circular chrome behind it */}
        <button
          onClick={() => setOpen(v => !v)}
          className="relative hover:scale-105 transition-transform flex items-center justify-center shrink-0 drop-shadow-xl"
          aria-label="Open Emergy"
          style={{ width: 80, height: 80 }}
        >
          <EmergySVG state={state} size={72} />
          {isScreaming && (
            <span className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          )}
        </button>
      </div>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-[148px] lg:bottom-[128px] right-6 z-50 w-80 h-[480px] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
            <EmergySVG state={state} size={40} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Emergy</p>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${Math.round((emergy?.progress ?? 0) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {emergy?.levelName ?? "Seed"} Lv.{emergy?.level ?? 0}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {notifPerm === "default" && (
                <button
                  onClick={enablePush}
                  title="Enable push notifications"
                  className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                >
                  <Bell className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Brief / message */}
          <div className="px-3 py-2 border-b border-border/50 bg-secondary/20 shrink-0">
            {briefLoading ? (
              <p className="text-xs text-muted-foreground italic">Thinking…</p>
            ) : brief ? (
              <p className="text-xs leading-relaxed">{brief}</p>
            ) : emergy ? (
              <p className="text-xs leading-relaxed">{emergy.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Loading…</p>
            )}
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center pt-4">
                Ask Emergy anything about your health!
              </p>
            )}
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex gap-1.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="shrink-0 mt-0.5">
                    <EmergySVG state={state} size={20} />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary"
                  }`}
                >
                  {msg.content || <span className="animate-pulse">…</span>}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex gap-2 px-3 py-2 border-t border-border shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder="Ask Emergy…"
              className="flex-1 text-xs bg-secondary rounded-lg px-3 py-1.5 outline-none border border-transparent focus:border-primary/50 transition-colors"
              disabled={sending}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
