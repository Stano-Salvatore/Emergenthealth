"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Send, Bell } from "lucide-react"
import { EmergySVG, EmergyState } from "./EmergySVG"

interface EmergyData {
  state: EmergyState
  message: string
  xp: number
  level: number
  levelName: string
  xpProgress: number
  waterMl: number
  isScreening: boolean
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

const STORAGE_KEY = "emergy-panel-open"

export function EmergyPanel() {
  const [mounted, setMounted] = useState(false)
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

  // Restore persisted state before first render
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "true") setOpen(true)
    setMounted(true)
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission)
  }, [])

  const toggle = useCallback(() => {
    setOpen(v => {
      const next = !v
      localStorage.setItem(STORAGE_KEY, String(next))
      if (next) setShowBubble(false)
      return next
    })
  }, [])

  const fetchEmergy = useCallback(async () => {
    try {
      const res = await fetch("/api/emergy")
      if (res.ok) setEmergy(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchEmergy()
    intervalRef.current = setInterval(fetchEmergy, 5 * 60 * 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchEmergy])

  // Speech bubble when a new message arrives and panel is closed
  useEffect(() => {
    if (!emergy?.message || open || emergy.message === lastShownMessage) return
    setShowBubble(true)
    setLastShownMessage(emergy.message)
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = setTimeout(() => setShowBubble(false), 7000)
    return () => { if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current) }
  }, [emergy?.message, open, lastShownMessage])

  // Load chat + brief when panel opens
  useEffect(() => {
    if (!open) return
    fetch("/api/chat")
      .then(r => r.json())
      .then((data: ChatMessage[]) => { if (Array.isArray(data)) setMessages(data.slice(-50)) })
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
              setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullText } : m))
            }
          } catch {}
        }
      }
    } catch {}
    setSending(false)
    inputRef.current?.focus()
  }

  if (!mounted) return null

  const state = emergy?.state ?? "okay"
  const isScreaming = emergy?.isScreening ?? false
  // Panel is 320px, tab is 40px. Translate 320px when closed so only tab shows.
  const PANEL_W = 320
  const TAB_W = 40

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden" onClick={toggle} />
      )}

      {/* Speech bubble — floats to the left of the tab when panel is closed */}
      {showBubble && !open && emergy?.message && (
        <div
          className="fixed top-1/2 -translate-y-1/2 z-50 pointer-events-auto"
          style={{ right: TAB_W + 12, animation: "emg-bubble-in 0.25s ease-out" }}
        >
          <style>{`
            @keyframes emg-bubble-in {
              from { opacity: 0; transform: translateY(-50%) translateX(8px) scale(0.96); }
              to   { opacity: 1; transform: translateY(-50%) translateX(0)   scale(1); }
            }
          `}</style>
          <div className="relative bg-card border border-border rounded-2xl px-3 py-2.5 shadow-xl text-xs leading-relaxed max-w-[220px] pr-7">
            {emergy.message}
            <button
              onClick={() => setShowBubble(false)}
              aria-label="Dismiss"
              className="absolute top-1.5 right-1.5 w-4 h-4 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-[10px]"
            >
              ✕
            </button>
          </div>
          {/* Arrow pointing right toward tab */}
          <div
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[5px] rotate-45 w-2.5 h-2.5 bg-card border-r border-b border-border"
            aria-hidden="true"
          />
        </div>
      )}

      {/* Wrapper: [tab 40px][panel 320px], translates so only tab shows when closed */}
      <div
        className="fixed right-0 top-0 h-screen z-40 flex"
        style={{
          width: TAB_W + PANEL_W,
          transform: open ? "translateX(0)" : `translateX(${PANEL_W}px)`,
          transition: mounted ? "transform 0.3s cubic-bezier(0.4,0,0.2,1)" : "none",
        }}
      >
        {/* ── Tab / handle ── */}
        <button
          onClick={toggle}
          aria-label={open ? "Close Emergy panel" : "Open Emergy panel"}
          className="relative shrink-0 flex flex-col items-center justify-center gap-2 bg-card border border-r-0 border-border rounded-l-2xl shadow-lg hover:bg-secondary/50 transition-colors cursor-pointer"
          style={{ width: TAB_W }}
        >
          {/* Unread dot */}
          {!open && showBubble && (
            <span className="absolute top-3 right-2.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
          {isScreaming && (
            <span className="absolute top-3 right-2.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          )}
          <EmergySVG state={state} size={30} />
          <span
            className="text-[9px] font-medium text-muted-foreground select-none"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: "0.06em" }}
          >
            Emergy
          </span>
        </button>

        {/* ── Chat panel ── */}
        <div className="flex flex-col bg-card border-l border-border shadow-2xl" style={{ width: PANEL_W }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-border shrink-0">
            <EmergySVG state={state} size={36} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">Emergy</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${Math.round((emergy?.xpProgress ?? 0) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {emergy?.levelName ?? "Seed"} Lv.{emergy?.level ?? 0}
                </span>
              </div>
            </div>
            {notifPerm === "default" && (
              <button
                onClick={enablePush}
                title="Enable push notifications"
                className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
              >
                <Bell className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Brief / current message */}
          <div className="px-3 py-2 border-b border-border/50 bg-secondary/20 shrink-0">
            {briefLoading ? (
              <p className="text-xs text-muted-foreground italic">Thinking…</p>
            ) : brief ? (
              <p className="text-xs leading-relaxed">{brief}</p>
            ) : emergy ? (
              <p className="text-xs leading-relaxed">{emergy.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground animate-pulse">Loading…</p>
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
      </div>
    </>
  )
}
