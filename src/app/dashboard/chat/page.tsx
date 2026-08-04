"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send, User, Mic, MicOff, History, Plus, Trash2, X } from "lucide-react"
import { EmergySVG, type EmergyState } from "@/components/emergy/EmergySVG"

interface Message {
  id?: string
  role: "user" | "assistant"
  content: string
  streaming?: boolean
}

interface Conversation {
  id: string
  title: string
  updatedAt: string
}

function MessageBubble({ msg, emergyState }: { msg: Message; emergyState: EmergyState }) {
  const isUser = msg.role === "user"
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div className="shrink-0 mt-0.5">
        {isUser ? (
          <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-white"/>
          </div>
        ) : (
          <EmergySVG state={emergyState} size={28}/>
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? "bg-primary text-white rounded-tr-sm"
            : "bg-[#1a2a1a] text-foreground rounded-tl-sm border border-green-900/30"
        } ${msg.streaming ? "opacity-85" : ""}`}
      >
        {msg.content}
        {msg.streaming && <span className="animate-pulse ml-0.5">▍</span>}
      </div>
    </div>
  )
}

function conversationDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [emergyState, setEmergyState] = useState<EmergyState>("okay")
  const [listening, setListening] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!SR) return

    const rec = new SR()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = "en-US"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript
      setInput((prev) => prev ? prev + " " + transcript : transcript)
      setListening(false)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const refreshConversations = useCallback(() => {
    fetch("/api/chat/conversations").then(async (r) => {
      if (r.ok) setConversations(await r.json())
    }).catch(() => {})
  }, [])

  // A fresh visit starts a new empty chat (quick questions visible); past chats
  // live in the History panel.
  useEffect(() => {
    refreshConversations()
    fetch("/api/emergy").then(async (r) => {
      if (r.ok) { const d = await r.json(); setEmergyState(d.state) }
    }).catch(() => {})
  }, [refreshConversations])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  function newChat() {
    if (sending) return
    setMessages([])
    setConversationId(null)
    setHistoryOpen(false)
    textareaRef.current?.focus()
  }

  async function openConversation(id: string) {
    if (sending) return
    setHistoryOpen(false)
    const res = await fetch(`/api/chat?conversation=${encodeURIComponent(id)}`)
    if (!res.ok) return
    const msgs = await res.json()
    setMessages(msgs)
    setConversationId(id)
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    await fetch(`/api/chat/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {})
    setConversations((c) => c.filter(conv => conv.id !== id))
    if (conversationId === id) newChat()
  }

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || sending) return

    const userMsg: Message = { role: "user", content: overrideText ?? text }
    setMessages((m) => [...m, userMsg])
    if (!overrideText) setInput("")
    setSending(true)

    const history = messages.map((m) => ({ role: m.role, content: m.content }))

    const assistantMsg: Message = { role: "assistant", content: "", streaming: true }
    setMessages((m) => [...m, assistantMsg])

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, conversationId }),
      })

      if (!res.body) throw new Error("No stream")

      const reader = res.body.getReader()
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
            setMessages((m) =>
              m.map((msg, i) =>
                i === m.length - 1 ? { ...msg, streaming: false } : msg
              )
            )
            break
          }
          try {
            const parsed = JSON.parse(data)
            if (parsed.conversationId) {
              setConversationId(parsed.conversationId)
            } else if (parsed.text) {
              setMessages((m) =>
                m.map((msg, i) =>
                  i === m.length - 1 ? { ...msg, content: msg.content + parsed.text } : msg
                )
              )
            }
          } catch {}
        }
      }
      refreshConversations()
    } catch {
      setMessages((m) =>
        m.map((msg, i) =>
          i === m.length - 1
            ? { ...msg, content: "Sorry, something went wrong.", streaming: false }
            : msg
        )
      )
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function quickSend(prompt: string) {
    if (sending) return
    setInput("")
    sendMessage(prompt)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem-3rem)]">
      <div className="flex items-center gap-3 mb-4 relative">
        <EmergySVG state={emergyState} size={52}/>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">Emergy</h1>
          <p className="text-muted-foreground text-sm mt-0.5 truncate">
            Your plant companion — knows your health, habits &amp; finances
          </p>
        </div>
        <Button
          onClick={() => setHistoryOpen((o) => !o)}
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          title="Past chats"
        >
          {historyOpen ? <X className="h-4 w-4" /> : <History className="h-4 w-4" />}
        </Button>
        <Button
          onClick={newChat}
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          title="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>

        {historyOpen && (
          <div className="absolute right-0 top-full mt-2 z-30 w-72 max-h-80 overflow-y-auto rounded-2xl border border-border bg-background shadow-xl shadow-black/30 p-1.5">
            {conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No past chats yet 🌱</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-colors group ${
                    c.id === conversationId ? "bg-primary/10 text-primary" : "hover:bg-secondary/60"
                  }`}
                >
                  <span className="flex-1 min-w-0 text-sm truncate">{c.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{conversationDate(c.updatedAt)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => deleteConversation(c.id, e)}
                    onKeyDown={(e) => { if (e.key === "Enter") deleteConversation(c.id, e as unknown as React.MouseEvent) }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-1 text-muted-foreground hover:text-red-400 transition-all"
                    aria-label="Delete chat"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 scrollbar-thin pr-1"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12">
            <EmergySVG state={emergyState} size={100}/>
            <div>
              <p className="font-semibold text-base">Hi!! I&apos;m Emergy 🌱</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                I know your sleep, habits, meds, finances, and calendar. Ask me anything or just say hi!
              </p>
            </div>
            {/* Morning briefing CTA */}
            <button
              onClick={() => quickSend("Give me a morning briefing: last night's sleep score and quality, today's schedule, which habits I still need to do, any overdue reminders, and what supplements/meds I've taken so far.")}
              disabled={sending}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-green-700/20 border border-green-700/30 hover:bg-green-700/30 transition-colors text-sm font-medium text-green-400 disabled:opacity-50"
            >
              ☀️ Morning Briefing
            </button>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
              {[
                "🌅 Log my morning check-in (I feel good and ready)",
                "How was my sleep this week?",
                "Does coffee affect my sleep? Check my Oura tags",
                "What habits am I missing today?",
                "What supplements did I take today?",
                "What's on my calendar this week?",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => { setInput(prompt); textareaRef.current?.focus() }}
                  className="text-left text-sm px-4 py-2.5 rounded-xl border border-border bg-secondary hover:bg-accent transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => <MessageBubble key={i} msg={msg} emergyState={emergyState}/>)
        )}
      </div>

      <div className="mt-4 flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          placeholder="Talk to Emergy..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          className="resize-none flex-1 bg-secondary border-border"
        />
        <Button
          onClick={listening ? stopListening : startListening}
          disabled={sending}
          size="icon"
          variant={listening ? "destructive" : "outline"}
          className={`h-10 w-10 shrink-0 ${listening ? "animate-pulse" : ""}`}
          title={listening ? "Stop recording" : "Voice input"}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Button
          onClick={() => sendMessage()}
          disabled={!input.trim() || sending}
          size="icon"
          className="h-10 w-10 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground text-center mt-2">
        {listening ? "Listening… speak now" : "Enter to send · Shift+Enter for new line · 🎤 for voice"}
      </p>
    </div>
  )
}
