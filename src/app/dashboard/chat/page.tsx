"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send, User, Mic, MicOff, History, Plus, Trash2, X } from "lucide-react"
import { EmergyAvatar, type EmergyState } from "@/components/emergy/EmergyAvatar"
import { ChatMarkdown } from "@/components/emergy/ChatMarkdown"
import { isFeatureEnabled } from "@/lib/features"

// An error we already have a human sentence for — shown to the user verbatim
// instead of the generic fallback.
class ChatError extends Error {}

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
          <EmergyAvatar mood={emergyState} fit="icon" size={28}/>
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-white rounded-tr-sm whitespace-pre-wrap"
            : "bg-[#1a2a1a] text-foreground rounded-tl-sm border border-green-900/30"
        } ${msg.streaming ? "opacity-85" : ""}`}
      >
        {isUser ? msg.content : <ChatMarkdown text={msg.content} />}
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
  const historyRef = useRef<HTMLDivElement>(null)
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

  // Text shared from another app lands here. The manifest used to point the
  // share target at the journal, which never read the parameter, so anything
  // shared into the app vanished. It goes to the composer rather than sending
  // itself — a shared link usually needs a sentence of context first.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const shared = [params.get("title"), params.get("text"), params.get("url")]
      .filter(Boolean)
      .join(" ")
      .trim()
    if (!shared) return
    setInput(prev => (prev ? `${prev} ${shared}` : shared))
    // Drop the query so a refresh doesn't paste it a second time.
    window.history.replaceState({}, "", window.location.pathname)
  }, [])

  // ?listen=1 — the home-screen widget's whole reason to exist. The cost of
  // logging something isn't the typing, it's the unlock, the launch, the tab
  // and the keyboard; arriving already listening removes all four.
  //
  // Deferred a beat because dictation needs the page interactive and, the
  // first time, a permission prompt — firing during mount would ask before
  // there is anything on screen to explain why.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("listen") !== "1") return
    window.history.replaceState({}, "", window.location.pathname)
    const t = setTimeout(() => { startListening() }, 350)
    return () => clearTimeout(t)
  }, [startListening])

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

  // Tapping anywhere outside the panel (or pressing Escape) closes it — the X
  // was previously the only way out.
  useEffect(() => {
    if (!historyOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!historyRef.current?.contains(e.target as Node)) setHistoryOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHistoryOpen(false) }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [historyOpen])

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

      // Error replies are plain JSON, not a stream. Without this check the
      // parser below finds no "data:" lines, falls out of the loop silently and
      // leaves an empty bubble stuck on the blinking cursor forever.
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        if (res.status === 429) {
          const mins = typeof body?.resetAt === "number"
            ? Math.max(1, Math.ceil((body.resetAt - Date.now()) / 60000))
            : null
          throw new ChatError(
            mins
              ? `Phew — that's a lot of questions 🌱 I can pick this back up in about ${mins} minute${mins === 1 ? "" : "s"}.`
              : "Phew — that's a lot of questions 🌱 Give me a little while and ask again."
          )
        }
        if (res.status === 401) {
          throw new ChatError("You've been signed out. Sign in again and I'll be right here 🌱")
        }
        throw new ChatError("I couldn't reach my brain just now — please try again in a moment.")
      }

      if (!res.body) throw new ChatError("I couldn't reach my brain just now — please try again in a moment.")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let received = false

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
              received = true
              setMessages((m) =>
                m.map((msg, i) =>
                  i === m.length - 1 ? { ...msg, content: msg.content + parsed.text } : msg
                )
              )
            }
          } catch {}
        }
      }
      // A stream that ended without a single token would also leave a blank
      // bubble — say something instead.
      if (!received) throw new ChatError("I went quiet there, sorry — ask me again?")
      refreshConversations()
    } catch (err) {
      const note = err instanceof ChatError
        ? err.message
        : "Sorry, something went wrong. Please try again."
      setMessages((m) =>
        m.map((msg, i) => {
          if (i !== m.length - 1) return msg
          // If the connection dropped mid-answer, keep what he already said
          // and add the note rather than throwing the reply away.
          const content = msg.content ? `${msg.content}\n\n_${note}_` : note
          return { ...msg, content, streaming: false }
        })
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

  // Emergy's intro must only promise what this build actually ships — finances
  // are held back for a later release (see src/lib/features.ts).
  const financesOn = isFeatureEnabled("finances")
  const subtitle = financesOn
    ? "Your plant companion — knows your health, habits & finances"
    : "Your plant companion — knows your sleep, habits, meds & calendar"
  const intro = financesOn
    ? "I know your sleep, habits, meds, finances, and calendar. Ask me anything or just say hi!"
    : "I know your sleep, habits, meds, and calendar. Ask me anything or just say hi!"

  // Every suggestion sends straight away — previously the big briefing button
  // sent while the six below it only pasted text, which looked identical but
  // behaved differently.
  const QUICK_QUESTIONS = [
    "🌅 Start my morning check-in",
    "How was my sleep this week?",
    "Does coffee affect my sleep? Check my Oura tags",
    "What habits am I missing today?",
    "What supplements did I take today?",
    "What's on my calendar this week?",
  ]

  return (
    // Fill exactly the space the shell leaves us: 100dvh follows the real
    // visible viewport on phones (100vh does not — it assumes the browser's
    // URL bar is hidden), minus the shell's own padding, so the composer can
    // never end up underneath the bottom nav.
    <div className="flex flex-col h-[calc(100dvh_-_5.75rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] lg:h-[calc(100dvh_-_3rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-3 mb-4">
        <EmergyAvatar mood={emergyState} fit="icon" size={52}/>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">Emergy</h1>
          <p className="text-muted-foreground text-sm mt-0.5 truncate">{subtitle}</p>
        </div>

        <div ref={historyRef} className="relative shrink-0 flex items-center gap-3">
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
                  // Row is a plain container: the delete control is a real
                  // button, so it can't be nested inside the open-chat button.
                  <div
                    key={c.id}
                    className={`w-full flex items-center rounded-xl transition-colors ${
                      c.id === conversationId ? "bg-primary/10 text-primary" : "hover:bg-secondary/60"
                    }`}
                  >
                    <button
                      onClick={() => openConversation(c.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 pl-3 pr-1 py-2 text-left"
                    >
                      <span className="flex-1 min-w-0 text-sm truncate">{c.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{conversationDate(c.updatedAt)}</span>
                    </button>
                    {/* Always visible — hover-to-reveal made this unreachable
                        on a touchscreen, so chats couldn't be deleted at all. */}
                    <button
                      onClick={(e) => deleteConversation(c.id, e)}
                      className="shrink-0 p-2 mr-0.5 rounded-lg text-muted-foreground/60 hover:text-red-400 transition-colors"
                      aria-label={`Delete chat: ${c.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 scrollbar-thin pr-1"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12">
            <EmergyAvatar mood={emergyState} fit="full" size={100} height={125}/>
            <div>
              <p className="font-semibold text-base">Hi!! I&apos;m Emergy 🌱</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">{intro}</p>
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
              {QUICK_QUESTIONS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => quickSend(prompt)}
                  disabled={sending}
                  className="text-left text-sm px-4 py-2.5 rounded-xl border border-border bg-secondary hover:bg-accent transition-colors disabled:opacity-50"
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
