"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { isNativeShell } from "@/lib/native/shell"
import { usePathname } from "next/navigation"
import { X, Send, Bell, Mic, Square, Volume2, VolumeX, ImagePlus } from "lucide-react"
import {
  dictationSupport, startDictation, speak, stopSpeaking, speechSupported,
  listVoices, resolveVoice, getSavedVoiceUri, getVoiceRate, getAutoSpeak, saveAutoSpeak,
  type DictationHandle, type DictationSupport,
} from "@/lib/voice"
import { EmergyAvatar } from "./EmergyAvatar"
import { ChatMarkdown } from "./ChatMarkdown"
import { useEmergy } from "@/lib/emergy-store"
import { todaysThread } from "@/lib/chat-thread"

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

export function EmergyPanel() {
  const pathname = usePathname()
  // On mobile Emergy lives in the bottom nav, which polls /api/emergy itself.
  // Hiding this panel with CSS still left it mounted and polling for a UI
  // nobody could see, so it now genuinely only exists at lg+.
  const [isDesktop, setIsDesktop] = useState(false)
  const [open, setOpen] = useState(false)
  // Shared with the nav and sidebar mascots — see lib/emergy-store.
  const emergy = useEmergy()
  const [brief, setBrief] = useState<string | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // The thread this panel is talking in — today's, the same one the chat page
  // resumes — so a follow-up reaches the model with what came before it.
  const [conversationId, setConversationId] = useState<string | null>(null)
  // Bumped by every send, so a thread load that lands after the user has
  // sent something — or while a reply is still streaming — does not replace
  // what is on screen.
  const sendCount = useRef(0)
  const inFlight = useRef(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [canDictate, setCanDictate] = useState<DictationSupport>("unsupported")
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const dictationRef = useRef<DictationHandle | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingImage, setPendingImage] = useState<{ mediaType: string; base64: string; preview: string } | null>(null)
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | null>(null)
  const [showBubble, setShowBubble] = useState(false)
  const [lastShownMessage, setLastShownMessage] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The badge follows whatever the shared store last saw, rather than being a
  // side effect of this component owning the fetch.
  useEffect(() => {
    if (!emergy || !("setAppBadge" in navigator)) return
    const incomplete = (emergy.totalHabits ?? 0) - (emergy.habitsDone ?? 0)
    if (incomplete > 0) navigator.setAppBadge(incomplete).catch(() => {})
    else navigator.clearAppBadge().catch(() => {})
  }, [emergy])

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

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

  // Opens on today's thread, like the chat page. The unscoped GET this used to
  // make returned the oldest rows ever saved, from every conversation mixed.
  useEffect(() => {
    if (!open) return
    const sentAtOpen = sendCount.current
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch("/api/chat/conversations")
        if (!r.ok) return
        const id = todaysThread(await r.json())
        let rows: ChatMessage[] = []
        if (id) {
          const res = await fetch(`/api/chat?conversation=${encodeURIComponent(id)}`)
          if (!res.ok) return
          const data = await res.json()
          rows = Array.isArray(data) ? data.slice(-50) : []
        }
        if (cancelled || inFlight.current || sendCount.current !== sentAtOpen) return
        setMessages(rows)
        setConversationId(id)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open) return

    // The same brief the dashboard card and the Brief page show. This panel
    // used to call a second endpoint with its own prompt and no cache, so the
    // desktop Emergy said something different from the phone's, and paid for
    // a fresh generation on every open. /api/briefing is cached per day and
    // period, so opening the panel is free once the brief exists.
    if (!brief) {
      setBriefLoading(true)
      fetch("/api/briefing")
        .then(r => r.ok ? r.json() : null)
        .then(d => setBrief(d?.briefing ?? null))
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

  async function pickImage(file: File) {
    setVoiceError(null)
    const bitmap = await createImageBitmap(file).catch(() => null)
    if (!bitmap) { setVoiceError("Couldn't read that image."); return }

    const MAX = 1280
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) { setVoiceError("Couldn't read that image."); return }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85)
    setPendingImage({ mediaType: "image/jpeg", base64: dataUrl.split(",")[1] ?? "", preview: dataUrl })
  }

  async function sendMessage() {
    const text = input.trim()
    // A photo alone is a valid message.
    if ((!text && !pendingImage) || sending) return
    setInput("")
    setSending(true)
    sendCount.current++
    inFlight.current = true

    const sentImage = pendingImage
    setPendingImage(null)
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text || (sentImage ? "📷 Photo" : ""),
    }
    // What came before this message in this thread, as the chat page sends
    // it. The server keeps the last twenty turns.
    const history = messages
      .filter(m => m.content)
      .map(({ role, content }) => ({ role, content }))
    setMessages(prev => [...prev, userMsg])

    const assistantMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: "assistant", content: "" }
    setMessages(prev => [...prev, assistantMsg])
    const showReply = (content: string) =>
      setMessages(prev => prev.map(m => (m.id === assistantMsg.id ? { ...m, content } : m)))

    let fullText = ""
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          conversationId,
          ...(sentImage ? { images: [{ mediaType: sentImage.mediaType, base64: sentImage.base64 }] } : {}),
        }),
      })
      // Error replies are plain JSON, not a stream.
      if (!res.ok || !res.body) {
        showReply(res.status === 429
          ? "_That's a lot of questions — give me a little while and ask again._"
          : "_I couldn't reach my brain just now — please try again in a moment._")
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      // One event can arrive split across two chunks; the unfinished tail
      // waits for the rest instead of being parsed (and dropped) on its own.
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6)
          if (data === "[DONE]") break
          try {
            const parsed = JSON.parse(data)
            // Only his words belong in the bubble. Thinking events carry
            // `text` too — his reasoning, which this used to print and read
            // aloud as though it were the reply.
            if (parsed.conversationId) {
              setConversationId(parsed.conversationId)
            } else if (parsed.type === "text" && parsed.text) {
              fullText += parsed.text
              showReply(fullText)
            }
          } catch {}
        }
      }
      if (!fullText.trim()) showReply("_I went quiet there, sorry — ask me again?_")
    } catch {
      // The server finishes the turn without an audience, so the reply cut
      // off here usually lands in the transcript anyway.
      showReply(fullText
        ? `${fullText}\n\n_Lost the connection — open Chat to see how it ended._`
        : "_Lost the connection — open Chat to see if I answered before asking again._")
    } finally {
      inFlight.current = false
      setSending(false)
      // Only the finished reply is spoken — reading each token as it streams
      // would stutter and restart on every chunk.
      if (autoSpeak && fullText.trim()) void speakReply(fullText)
      inputRef.current?.focus()
    }
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
          {pendingImage && (
            <div className="flex items-center gap-2 px-3 pt-2 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingImage.preview} alt="Attached" className="h-12 w-12 rounded-lg object-cover border border-border" />
              <span className="text-[11px] text-muted-foreground flex-1">Photo attached</span>
              <button
                onClick={() => setPendingImage(null)}
                aria-label="Remove photo"
                className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex gap-2 px-3 py-2 border-t border-border shrink-0 items-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void pickImage(file)
                e.target.value = ""
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={sending}
              aria-label="Attach a photo"
              title="Attach a photo — a lab printout, a med box, a meal"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
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
              disabled={sending || (!input.trim() && !pendingImage)}
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
