"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { isNativeShell } from "@/lib/native/shell"
import { usePathname } from "next/navigation"
import { X, Send, Bell, Mic, Square, Volume2, VolumeX } from "lucide-react"
import {
  dictationSupport, startDictation, speak, stopSpeaking, speechSupported,
  listVoices, resolveVoice, getSavedVoiceUri, getVoiceRate, getAutoSpeak, saveAutoSpeak,
  type DictationHandle, type DictationSupport,
} from "@/lib/voice"
import { EmergyAvatar, type EmergyState } from "./EmergyAvatar"
import { ChatMarkdown } from "./ChatMarkdown"

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
  const pathname = usePathname()
  // On mobile Emergy lives in the bottom nav, which polls /api/emergy itself.
  // Hiding this panel with CSS still left it mounted and polling for a UI
  // nobody could see, so it now genuinely only exists at lg+.
  const [isDesktop, setIsDesktop] = useState(false)
  const [open, setOpen] = useState(false)
  const [emergy, setEmergy] = useState<EmergyData | null>(null)
  const [brief, setBrief] = useState<string | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [canDictate, setCanDictate] = useState<DictationSupport>("unsupported")
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const dictationRef = useRef<DictationHandle | null>(null)
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
    const mq = window.matchMedia("(min-width: 1024px)")
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  useEffect(() => {
    if (!isDesktop) return
    fetchEmergy()
    intervalRef.current = setInterval(fetchEmergy, 5 * 60 * 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchEmergy, isDesktop])

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
      // Never in the shell: registering here would reinstall the worker the
      // app strips on launch, and with it the stale-code failure mode.
      if (isNativeShell()) return
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const support = await dictationSupport()
      if (!cancelled) setCanDictate(support)
    })()
    setAutoSpeak(getAutoSpeak())
    return () => { cancelled = true }
  }, [])

  /** Read a reply aloud in the voice chosen on this device. */
  const speakReply = useCallback(async (text: string) => {
    if (!speechSupported() || !text.trim()) return
    const voices = await listVoices()
    const voice = resolveVoice(voices, getSavedVoiceUri(), navigator.language)
    setSpeaking(true)
    const started = speak(text, { voice, rate: getVoiceRate(), onEnd: () => setSpeaking(false) })
    if (!started) setSpeaking(false)
  }, [])

  function toggleDictation() {
    setVoiceError(null)
    if (listening) {
      dictationRef.current?.stop()
      dictationRef.current = null
      setListening(false)
      return
    }
    setListening(true)
    void startDictation({
      // Words land in the box rather than sending themselves: a dictation that
      // fires off a half-heard sentence is worse than typing it.
      onPartial: text => setInput(text),
      onFinal: text => { setInput(text); setListening(false); dictationRef.current = null },
      onError: message => { setVoiceError(message); setListening(false); dictationRef.current = null },
    }).then(handle => {
      if (handle) dictationRef.current = handle
      else setListening(false)
    })
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

    let fullText = ""
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      // Returning here used to skip the reset below, leaving the composer
      // disabled until the panel was reopened.
      if (!res.body) throw new Error("no stream")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

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
    // Only the finished reply is spoken — reading each token as it streams
    // would stutter and restart on every chunk.
    if (autoSpeak && fullText.trim()) void speakReply(fullText)
    inputRef.current?.focus()
  }

  useEffect(() => () => {
    stopSpeaking()
    dictationRef.current?.stop()
  }, [])

  const state = emergy?.state ?? "okay"
  const isScreaming = emergy?.state === "screaming"

  // The chat page IS Emergy — a floating Emergy on top of it is redundant.
  // On mobile the mascot lives in the bottom nav instead (see BottomNav).
  if (!isDesktop || pathname?.startsWith("/dashboard/chat")) return null

  return (
    <>
      {/* Speech bubble + button row — desktop only */}
      <div className="fixed right-6 z-50 flex items-center gap-3 bottom-10">
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
          <EmergyAvatar mood={state} fit="icon" size={72} />
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
            <EmergyAvatar mood={state} fit="icon" size={40} />
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
                    <EmergyAvatar mood={state} fit="icon" size={20} />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary"
                  }`}
                >
                  {!msg.content ? (
                    <span className="animate-pulse">…</span>
                  ) : msg.role === "assistant" ? (
                    // Emergy is told its replies render as markdown — the phone
                    // chat page did, this panel showed the raw asterisks.
                    <ChatMarkdown text={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {voiceError && (
            <p className="px-3 pt-2 text-[10px] text-amber-400 shrink-0">{voiceError}</p>
          )}
          <div className="flex gap-2 px-3 py-2 border-t border-border shrink-0 items-center">
            {/* Speak replies aloud. Hidden where the device has no speech at
                all rather than offering a button that does nothing. */}
            {speechSupported() && (
              <button
                onClick={() => {
                  if (speaking) { stopSpeaking(); setSpeaking(false); return }
                  const next = !autoSpeak
                  setAutoSpeak(next)
                  saveAutoSpeak(next)
                }}
                aria-label={speaking ? "Stop speaking" : autoSpeak ? "Turn off spoken replies" : "Read replies aloud"}
                title={speaking ? "Stop speaking" : autoSpeak ? "Spoken replies on" : "Read replies aloud"}
                className={`p-1.5 rounded-lg transition-colors ${
                  speaking ? "bg-primary/20 text-primary animate-pulse"
                  : autoSpeak ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {autoSpeak || speaking ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>
            )}
            {canDictate !== "unsupported" && (
              <button
                onClick={toggleDictation}
                disabled={sending}
                aria-label={listening ? "Stop dictation" : "Dictate a message"}
                title={listening ? "Stop dictation" : "Dictate a message"}
                className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                  listening ? "bg-red-500/20 text-red-400 animate-pulse" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </button>
            )}
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={listening ? "Listening…" : "Ask Emergy…"}
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
