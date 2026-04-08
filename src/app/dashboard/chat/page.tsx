"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Bot, User, Trash2 } from "lucide-react"

interface Message {
  id?: string
  role: "user" | "assistant"
  content: string
  streaming?: boolean
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user"
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-primary" : "bg-secondary border border-border"
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-white" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-foreground" />
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-white rounded-tr-sm"
            : "bg-secondary text-foreground rounded-tl-sm"
        } ${msg.streaming ? "opacity-90" : ""}`}
      >
        {msg.content}
        {msg.streaming && <span className="animate-pulse">▍</span>}
      </div>
    </div>
  )
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch("/api/chat").then(async (r) => {
      if (r.ok) setMessages(await r.json())
    })
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return

    const userMsg: Message = { role: "user", content: text }
    setMessages((m) => [...m, userMsg])
    setInput("")
    setSending(true)

    const history = messages.map((m) => ({ role: m.role, content: m.content }))

    const assistantMsg: Message = { role: "assistant", content: "", streaming: true }
    setMessages((m) => [...m, assistantMsg])

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
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
            const { text: chunk } = JSON.parse(data)
            setMessages((m) =>
              m.map((msg, i) =>
                i === m.length - 1 ? { ...msg, content: msg.content + chunk } : msg
              )
            )
          } catch {}
        }
      }
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

  return (
    <div className="flex flex-col h-[calc(100vh-3rem-3rem)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Claude AI</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Ask about your health, finances, habits, and more
          </p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 scrollbar-thin pr-1"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-16">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-medium">Claude knows your data</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                Ask about sleep patterns, spending habits, upcoming events, or get insights on your health trends.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 mt-2 w-full max-w-sm">
              {[
                "What did I spend the most on this month?",
                "How was my sleep this week?",
                "What habits am I missing today?",
                "What's coming up on my calendar?",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setInput(prompt)
                    textareaRef.current?.focus()
                  }}
                  className="text-left text-sm px-4 py-2.5 rounded-xl border border-border bg-secondary hover:bg-accent transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)
        )}
      </div>

      <div className="mt-4 flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          placeholder="Ask Claude anything about your data..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          className="resize-none flex-1 bg-secondary border-border"
        />
        <Button
          onClick={sendMessage}
          disabled={!input.trim() || sending}
          size="icon"
          className="h-10 w-10 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground text-center mt-2">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}
