"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, MicOff, Send, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { EmergySVG, type EmergyState } from "./EmergySVG"

interface EmergyData {
  state: EmergyState
  message: string
  waterMl: number
  sleepScore: number | null
  readinessScore: number | null
  habitsDone: number
  totalHabits: number
  habitsPct: number | null
  xp: number
  level: number
  levelName: string
  levelEmoji: string
  minXp: number
  nextXp: number
}

interface Message {
  id?: string
  role: "user" | "assistant"
  content: string
  streaming?: boolean
}

export function EmergyPanel() {
  const [open, setOpen]             = useState(false)
  const [emergy, setEmergy]         = useState<EmergyData | null>(null)
  const [showBubble, setShowBubble] = useState(false)
  const [messages, setMessages]     = useState<Message[]>([])
  const [input, setInput]           = useState("")
  const [sending, setSending]       = useState(false)
  const [chatLoaded, setChatLoaded] = useState(false)
  const [listening, setListening]   = useState(false)

  const scrollRef      = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const bubbleTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch Emergy state ──────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      const r = await fetch("/api/emergy")
      if (r.ok) setEmergy(await r.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchState()
    const iv = setInterval(fetchState, 5 * 60_000)
    return () => clearInterval(iv)
  }, [fetchState])

  // ── Speech bubble cycle ─────────────────────────────────────────────
  useEffect(() => {
    if (!emergy || open) return
    const interval = emergy.state === "screaming" ? 18_000 : 50_000
    const schedule = () => {
      bubbleTimer.current = setTimeout(() => {
        setShowBubble(true)
        bubbleTimer.current = setTimeout(() => {
          setShowBubble(false)
          schedule()
        }, 7_000)
      }, emergy.state === "screaming" ? 4_000 : 8_000)
    }
    schedule()
    return () => { if (bubbleTimer.current) clearTimeout(bubbleTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emergy?.state, open])

  // ── Load chat history when first opening ────────────────────────────
  useEffect(() => {
    if (open && !chatLoaded) {
      fetch("/api/chat")
        .then(r => r.json())
        .then(msgs => { setMessages(msgs); setChatLoaded(true) })
        .catch(() => setChatLoaded(true))
    }
  }, [open, chatLoaded])

  // ── Auto-scroll ──────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  // ── Send message ─────────────────────────────────────────────────────
  const sendMessage = async (override?: string) => {
    const text = (override ?? input).trim()
    if (!text || sending) return

    setMessages(m => [...m, { role: "user", content: text }])
    if (!override) setInput("")
    setSending(true)
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(m => [...m, { role: "assistant", content: "", streaming: true }])

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      })
      if (!res.body) throw new Error()

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
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
          if (data === "[DONE]") {
            setMessages(m => m.map((msg, i) => i === m.length - 1 ? { ...msg, streaming: false } : msg))
            break
          }
          try {
            const { text: chunk } = JSON.parse(data)
            setMessages(m => m.map((msg, i) =>
              i === m.length - 1 ? { ...msg, content: msg.content + chunk } : msg
            ))
          } catch {}
        }
      }
    } catch {
      setMessages(m => m.map((msg, i) =>
        i === m.length - 1 ? { ...msg, content: "oops, something went wrong 🌿", streaming: false } : msg
      ))
    } finally {
      setSending(false)
    }
  }

  // ── Voice input ──────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR() as SpeechRecognition
    rec.continuous = false; rec.interimResults = false; rec.lang = "en-US"
    rec.onresult = (e: SpeechRecognitionEvent) => {
      setInput(p => p ? p + " " + e.results[0][0].transcript : e.results[0][0].transcript)
      setListening(false)
    }
    rec.onerror = () => setListening(false)
    rec.onend   = () => setListening(false)
    recognitionRef.current = rec
    rec.start(); setListening(true)
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop(); setListening(false)
  }, [])

  // ── XP progress % ────────────────────────────────────────────────────
  const xpPct = emergy
    ? Math.min(100, ((emergy.xp - emergy.minXp) / Math.max(1, emergy.nextXp - emergy.minXp)) * 100)
    : 0

  const curState = emergy?.state ?? "okay"

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">

      {/* ── Chat panel ──────────────────────────────────────────────── */}
      {open && (
        <div className={cn(
          "w-[370px] max-h-[82vh] rounded-2xl border border-border shadow-2xl",
          "bg-[#0e0e0e] flex flex-col overflow-hidden"
        )}>
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#0a160a] border-b border-border shrink-0">
            <div className="shrink-0">
              <EmergySVG state={curState} size={48}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm">Emergy</span>
                {emergy && (
                  <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                    {emergy.levelEmoji} Lv.{emergy.level} {emergy.levelName}
                  </span>
                )}
              </div>
              {emergy && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all duration-700"
                         style={{ width: `${xpPct}%` }}/>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{emergy.xp} XP</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="h-7 w-7 rounded-full hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5"/>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
            {messages.length === 0 && !sending ? (
              <div className="flex flex-col items-center text-center gap-3 py-6">
                <EmergySVG state={curState} size={80}/>
                <div>
                  <p className="font-semibold text-sm">Hi! I'm Emergy 🌱</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[210px]">
                    I know your health, habits, and finances. Ask me anything or just say hi!
                  </p>
                </div>
                <div className="w-full space-y-1.5">
                  {[
                    "☀️ Give me a morning briefing",
                    "How was my sleep this week?",
                    "Log 250ml of water for me",
                    "What habits did I miss today?",
                  ].map(p => (
                    <button key={p} onClick={() => sendMessage(p)}
                      className="w-full text-left text-xs px-3 py-2 rounded-xl border border-border bg-secondary hover:bg-accent transition-colors">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  {msg.role === "assistant" && (
                    <div className="shrink-0 mt-0.5">
                      <EmergySVG state={curState} size={26}/>
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-white rounded-tr-sm"
                      : "bg-[#1a2a1a] text-foreground rounded-tl-sm border border-green-900/30",
                    msg.streaming && "opacity-85"
                  )}>
                    {msg.content}
                    {msg.streaming && <span className="animate-pulse ml-0.5">▍</span>}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2 p-3 border-t border-border shrink-0">
            <textarea
              ref={inputRef}
              placeholder="Talk to Emergy..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              rows={1}
              className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-green-600 min-h-[36px] max-h-[100px]"
            />
            <button
              onClick={listening ? stopListening : startListening}
              disabled={sending}
              className={cn(
                "h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-colors",
                listening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-secondary hover:bg-accent text-muted-foreground",
                "disabled:opacity-50"
              )}
            >
              {listening ? <MicOff className="h-3.5 w-3.5"/> : <Mic className="h-3.5 w-3.5"/>}
            </button>
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || sending}
              className="h-9 w-9 shrink-0 rounded-xl bg-green-700 hover:bg-green-600 text-white flex items-center justify-center disabled:opacity-40 transition-colors"
            >
              <Send className="h-3.5 w-3.5"/>
            </button>
          </div>
        </div>
      )}

      {/* ── Speech bubble ────────────────────────────────────────────── */}
      {showBubble && !open && emergy && (
        <div
          onClick={() => { setShowBubble(false); setOpen(true) }}
          className={cn(
            "max-w-[220px] rounded-2xl rounded-br-none px-4 py-2.5 shadow-xl cursor-pointer",
            "border transition-all",
            emergy.state === "screaming"
              ? "bg-red-950/90 border-red-700/40 text-red-200"
              : "bg-[#0e1a0e] border-green-900/40 text-green-100"
          )}
        >
          <p className={cn(
            "text-sm leading-snug",
            emergy.state === "screaming" && "font-semibold"
          )}>
            {emergy.message}
          </p>
          {/* Pointer */}
          <div className="absolute bottom-0 right-4 translate-y-full">
            <div className={cn(
              "w-0 h-0 border-l-[8px] border-l-transparent",
              "border-t-[8px]",
              emergy.state === "screaming"
                ? "border-t-red-950/90"
                : "border-t-[#0e1a0e]"
            )}/>
          </div>
        </div>
      )}

      {/* ── Floating trigger ─────────────────────────────────────────── */}
      <button
        onClick={() => { setOpen(o => !o); setShowBubble(false) }}
        title="Emergy"
        className={cn(
          "relative rounded-2xl p-1.5 transition-all duration-200",
          "hover:scale-110 active:scale-95",
          open
            ? "bg-[#0e1a0e] border-2 border-green-800/50 shadow-xl shadow-green-950/30"
            : "hover:bg-green-950/20"
        )}
      >
        <EmergySVG state={curState} size={64}/>
        {/* Screaming pulse dot */}
        {curState === "screaming" && (
          <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full border-2 border-background animate-pulse"/>
        )}
        {/* Thriving glow dot */}
        {curState === "thriving" && (
          <span className="absolute -top-1 -right-1 h-4 w-4 bg-green-400 rounded-full border-2 border-background"/>
        )}
      </button>
    </div>
  )
}
