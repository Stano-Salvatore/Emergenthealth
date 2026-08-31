"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  getAutoSpeak, getSavedVoiceUri, getVoiceRate, listVoices, resolveVoice, saveAutoSpeak,
  speak, speechSupported, startDictation, stopSpeaking, type DictationHandle,
} from "@/lib/voice"
import { Send, User, Mic, Square, History, Plus, Trash2, X, Sunrise, Copy, Check, RotateCcw, Volume2, VolumeX } from "lucide-react"
import { EmergyAvatar, type EmergyState } from "@/components/emergy/EmergyAvatar"
import { useEmergyState, refreshEmergy } from "@/lib/emergy-store"
import { ChatMarkdown } from "@/components/emergy/ChatMarkdown"
import { SourceTrail, ThinkingLine, ToolActivity } from "@/components/emergy/SourceTrail"
import type { SourceChip } from "@/lib/chat-sources"
import { isFeatureEnabled } from "@/lib/features"

// An error we already have a human sentence for — shown to the user verbatim
// instead of the generic fallback.
class ChatError extends Error {}

interface Message {
  id?: string
  role: "user" | "assistant"
  content: string
  streaming?: boolean
  /** What he read to answer — only ever set from the server's own accounting. */
  sources?: SourceChip[]
  /** The tool he is in the middle of, while he is in the middle of it. */
  activeTool?: string
}

interface Conversation {
  id: string
  title: string
  updatedAt: string
}

/**
 * Copy and retry, on a finished reply only. Mid-stream there is nothing whole
 * to copy and nothing settled to retry.
 */
function MessageActions({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard is permission-gated and absent in some webviews; saying
      // nothing is better than an error for something this incidental.
    }
  }

  return (
    <div className="flex gap-1 mt-2 -mb-1 -ml-1.5">
      <button
        onClick={copy}
        className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
        aria-label={copied ? "Copied" : "Copy reply"}
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {onRetry && (
        <button
          onClick={onRetry}
          className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Ask again"
          title="Ask again"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function MessageBubble({ msg, emergyState, onRetry }: { msg: Message; emergyState: EmergyState; onRetry?: () => void }) {
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
        className={`${isUser ? "max-w-[80%]" : "max-w-[88%]"} rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-white rounded-tr-sm whitespace-pre-wrap"
            : "bg-card text-foreground rounded-tl-sm border border-border"
        }`}
      >
        {isUser ? msg.content : <ChatMarkdown text={msg.content} />}
        {/* Three different waits, three different things to say.
            · Nothing yet, no tool — he is thinking, so say so, and keep saying
              a different thing so a slow answer does not look like a dead one.
            · Text arriving — a caret at the end of it, because that is what a
              caret means.
            · A tool running — the row below names the wait, and two competing
              "still working" signals would just be noise. */}
        {msg.streaming && !msg.activeTool && !msg.content && (
          <ThinkingLine seed={msg.id ?? "emergy"} />
        )}
        {msg.streaming && !msg.activeTool && !!msg.content && (
          <span className="animate-pulse ml-0.5">▍</span>
        )}
        {msg.streaming && msg.activeTool && (
          <div className={msg.content ? "mt-2" : ""}><ToolActivity tool={msg.activeTool} /></div>
        )}
        {!isUser && msg.sources && <SourceTrail chips={msg.sources} />}
        {!isUser && !msg.streaming && msg.content && (
          <MessageActions text={msg.content} onRetry={onRetry} />
        )}
      </div>
    </div>
  )
}

/** Tools that change something, and so can change how Emergy is feeling. */
const WRITES = /^(log_|create_|complete_|write_|correct_|delete_|remember$)/

function safeChips(raw: string): SourceChip[] | undefined {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
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
  // Shared with the nav and sidebar mascots — see lib/emergy-store.
  const emergyState = useEmergyState()
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  // Reading replies aloud. lib/voice has done this all along and the floating
  // panel has used it all along; this page — the one the Emergy tab opens —
  // imported the microphone and nothing else, so a voice chosen in Settings
  // said its sample and was never heard again. Same preference key as the
  // panel and Settings, so the three cannot disagree about whether it is on.
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<DictationHandle | null>(null)

  // This page had its own copy of the browser SpeechRecognition API, which does
  // not exist inside an Android WebView — so in the app the mic button hit
  // `if (!SR) return` and did nothing at all, with no error and no explanation.
  // The native path already existed in lib/voice and the floating panel already
  // used it; only this page was left behind. Both surfaces go through the same
  // code now, and an unsupported build says so instead of going quiet.
  const startListening = useCallback(() => {
    setVoiceError(null)
    setListening(true)
    void startDictation({
      // Words land in the box rather than sending themselves: a dictation that
      // fires off a half-heard sentence is worse than typing it.
      onPartial: text => setInput(text),
      onFinal: text => { setInput(text); setListening(false); recognitionRef.current = null },
      onError: message => { setVoiceError(message); setListening(false); recognitionRef.current = null },
    }).then(handle => {
      if (handle) recognitionRef.current = handle
      else setListening(false)
    })
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

  useEffect(() => { setAutoSpeak(getAutoSpeak()) }, [])

  // Nothing should still be talking after this page is gone.
  useEffect(() => () => stopSpeaking(), [])

  /**
   * Read a reply aloud, and notice when the device only pretends to.
   *
   * speechSynthesis.speak() queues an utterance and reports nothing back, so
   * on a platform with no working speech engine the icon lights up over
   * silence for ever. If sound has not started within a couple of seconds,
   * that is said out loud rather than left to look like it worked — the same
   * mistake the microphone on this page used to make.
   */
  const speakReply = useCallback(async (text: string) => {
    if (!speechSupported() || !text.trim()) return
    const voices = await listVoices()
    const voice = resolveVoice(voices, getSavedVoiceUri(), navigator.language)
    setSpeaking(true)
    const queued = speak(text, {
      voice,
      rate: getVoiceRate(),
      onStart: () => setVoiceError(null),
      onEnd: () => setSpeaking(false),
      onSilent: () => {
        setSpeaking(false)
        setVoiceError("Your device accepted the speech but never played it — spoken replies are off.")
        setAutoSpeak(false)
        saveAutoSpeak(false)
      },
    })
    if (!queued) setSpeaking(false)
  }, [])

  function toggleSpeech() {
    setVoiceError(null)
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    const next = !autoSpeak
    setAutoSpeak(next)
    saveAutoSpeak(next)
    // Turning it on reads the answer already on screen, rather than making the
    // user ask something again to find out whether it works.
    if (next) {
      const last = [...messages].reverse().find(m => m.role === "assistant" && !m.streaming)
      if (last?.content) void speakReply(last.content)
    }
  }

  // ?conversation=<id> — arriving at a specific thread rather than a blank one.
  //
  // This is how a tapped chat head lands on what Emergy actually said. The
  // native bridge turns the phone's pending message into a real conversation
  // and sends us here; without this the app opened on an empty chat and the
  // one sentence you tapped in order to read was the one thing missing.
  useEffect(() => {
    if (typeof window === "undefined") return
    const id = new URLSearchParams(window.location.search).get("conversation")
    if (!id) return
    window.history.replaceState({}, "", window.location.pathname)
    void openConversation(id)
  // Once, for the id the page was opened with. openConversation is redefined
  // every render and depending on it would reopen the thread on each one,
  // throwing away anything typed since.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    recognitionRef.current = null
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
    const rows: (Omit<Message, "sources"> & { sources?: string | null })[] = await res.json()
    // Stored as JSON text; a row written before the trail existed has none, and
    // a malformed one is simply an answer without its receipts rather than a
    // conversation that won't open.
    setMessages(rows.map(row => ({
      ...row,
      sources: row.sources ? safeChips(row.sources) : undefined,
    })))
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
      let wroteSomething = false
      // The reply as one string. The messages array has it too, but reading it
      // back from state here would see the value from before this turn.
      let spoken = ""

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
                i === m.length - 1 ? { ...msg, streaming: false, activeTool: undefined } : msg
              )
            )
            break
          }
          try {
            const parsed = JSON.parse(data)
            // The stream carries three kinds of news now: his words, the tool
            // he just reached for, and — once he is done — what he read to
            // answer. Only the words are part of the message itself.
            if (parsed.conversationId) {
              setConversationId(parsed.conversationId)
            } else if (parsed.type === "text" && parsed.text) {
              received = true
              spoken += parsed.text
              setMessages((m) =>
                m.map((msg, i) =>
                  // Text resuming means the tool has come back: drop the
                  // activity row rather than leaving it up beside live output.
                  i === m.length - 1
                    ? { ...msg, content: msg.content + parsed.text, activeTool: undefined }
                    : msg
                )
              )
            } else if (parsed.type === "tool") {
              if (WRITES.test(parsed.name)) wroteSomething = true
              setMessages((m) =>
                m.map((msg, i) => (i === m.length - 1 ? { ...msg, activeTool: parsed.name } : msg))
              )
            } else if (parsed.type === "sources") {
              setMessages((m) =>
                m.map((msg, i) => (i === m.length - 1 ? { ...msg, sources: parsed.chips } : msg))
              )
            }
          } catch {}
        }
      }
      // A stream that ended without a single token would also leave a blank
      // bubble — say something instead.
      if (!received) throw new ChatError("I went quiet there, sorry — ask me again?")
      // Only the finished reply is read aloud: speaking each token as it
      // arrives would stutter and restart on every chunk.
      if (autoSpeak && spoken.trim()) void speakReply(spoken)
      refreshConversations()
      // Anything he logged this turn moves his mood — water before 4pm is the
      // difference between wilting and fine — so let his face catch up rather
      // than waiting out the five-minute poll.
      if (wroteSomething) void refreshEmergy()
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

  /**
   * Ask the last question again, as a new turn rather than a replacement.
   * Quietly dropping the previous answer would only drop it from the screen —
   * the stored transcript keeps every turn, so reopening the chat would show
   * something different from what you left. He can see he is being asked twice,
   * which is also the reason he will answer differently.
   */
  function retryFrom(assistantIndex: number) {
    if (sending) return
    const asked = messages[assistantIndex - 1]
    if (asked?.role !== "user") return
    sendMessage(asked.content)
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
  //
  // Label and prompt are separate so the pills can be short enough to sit two
  // to a row. Six full-width buttons stacked under the briefing CTA ran off the
  // bottom of a phone, which made the first thing anyone sees a scrolling menu.
  const QUICK_QUESTIONS: { label: string; prompt: string }[] = [
    { label: "Sleep this week", prompt: "How was my sleep this week?" },
    { label: "Coffee vs sleep", prompt: "Does coffee affect my sleep? Check my Oura tags" },
    { label: "Habits I'm missing", prompt: "What habits am I missing today?" },
    { label: "Supplements today", prompt: "What supplements did I take today?" },
    { label: "My week ahead", prompt: "What's on my calendar this week?" },
    { label: "Start my check-in", prompt: "Start my morning check-in" },
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
            onClick={toggleSpeech}
            size="icon"
            variant="outline"
            className={cn(
              "h-9 w-9 shrink-0",
              speaking ? "border-primary/50 bg-primary/15 text-primary"
                : autoSpeak ? "border-primary/40 text-primary" : "",
            )}
            aria-label={speaking ? "Stop speaking" : autoSpeak ? "Turn off spoken replies" : "Read replies aloud"}
            title={speaking ? "Stop speaking" : autoSpeak ? "Spoken replies on" : "Read replies aloud"}
          >
            {autoSpeak || speaking ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
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
        // The shell pads every page 48px on the left so content clears the
        // floating menu button, which sits above this list rather than beside
        // it. Reclaiming most of that gutter puts Emergy's avatar near the edge
        // like any other chat, instead of adrift in whitespace.
        className="flex-1 overflow-y-auto space-y-4 scrollbar-thin pr-1 -ml-9 lg:ml-0"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-start text-center space-y-3 pt-6 pb-12">
            {/* Top-aligned, not centred: with no mascot the centred version left
                a big empty gap up top and pushed the greeting to mid-screen.
                The header avatar above already names who you're talking to;
                this screen leads with the greeting and the things worth tapping. */}
            <div>
              <p className="font-semibold text-base">Hi!! I&apos;m Emergy 🌱</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">{intro}</p>
            </div>
            {/* One primary action; everything else is a quiet pill beneath it.
                Green is reserved for "on target" in this app, so the CTA takes
                the accent tint rather than a status colour. */}
            <button
              onClick={() => quickSend("Give me a morning briefing: last night's sleep score and quality, today's schedule, which habits I still need to do, any overdue reminders, and what supplements/meds I've taken so far.")}
              disabled={sending}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-primary/15 border border-primary/30 hover:bg-primary/25 transition-colors text-sm font-medium disabled:opacity-50"
            >
              <Sunrise className="h-4 w-4" />
              Morning briefing
            </button>
            <div className="flex flex-wrap justify-center gap-2 w-full max-w-sm">
              {QUICK_QUESTIONS.map(({ label, prompt }) => (
                <button
                  key={label}
                  onClick={() => quickSend(prompt)}
                  disabled={sending}
                  className="text-sm px-3.5 py-2 rounded-full border border-border bg-secondary hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              emergyState={emergyState}
              // Only the newest reply can be retried — replaying an older one
              // would silently throw away everything said after it.
              onRetry={msg.role === "assistant" && i === messages.length - 1 ? () => retryFrom(i) : undefined}
            />
          ))
        )}
      </div>

      {/* Whatever went wrong has to reach the screen. A mic that fails in
          silence is the bug this whole page just had — and a voice that fails
          in silence is indistinguishable from one that was never switched on.

          Above the composer, not below the hint under it. Down there it was
          the last element on the page and the bottom nav sat over it, so the
          one sentence explaining the failure was itself half invisible. */}
      {voiceError && (
        <p className="mt-3 px-4 text-center text-xs text-amber-400">{voiceError}</p>
      )}

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
        {/* A crossed-out mic conventionally means muted, so showing one *while*
            listening made a working mic look broken. Recording now reads as
            recording: a stop square on a live, pulsing button. */}
        <Button
          onClick={listening ? stopListening : startListening}
          disabled={sending}
          size="icon"
          variant={listening ? "destructive" : "outline"}
          className={`h-10 w-10 shrink-0 ${listening ? "animate-pulse" : ""}`}
          aria-pressed={listening}
          title={listening ? "Stop listening" : "Speak instead of typing"}
        >
          {listening ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
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
