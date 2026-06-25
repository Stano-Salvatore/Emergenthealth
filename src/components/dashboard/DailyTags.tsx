"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

const QUICK_SUGGESTIONS = [
  "headache", "great day", "tired", "travel", "social",
  "stress", "productive", "alcohol", "sick", "exercise",
]

const POSITIVE_TAGS = new Set(["great", "productive", "social", "exercise", "great day"])
const NEGATIVE_TAGS = new Set(["headache", "sick", "tired", "stress"])

function tagColor(tag: string): string {
  if (POSITIVE_TAGS.has(tag)) return "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30"
  if (NEGATIVE_TAGS.has(tag)) return "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
  // check for partial positive/negative keywords
  const lower = tag.toLowerCase()
  if (lower.includes("great") || lower.includes("produc") || lower.includes("social") || lower.includes("exercise")) {
    return "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30"
  }
  if (lower.includes("head") || lower.includes("sick") || lower.includes("tired") || lower.includes("stress")) {
    return "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
  }
  if (lower.includes("travel") || lower.includes("alcohol")) {
    return "bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30"
  }
  return "bg-secondary/60 text-muted-foreground border-border hover:bg-secondary"
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

export function DailyTags() {
  const [tags, setTags] = useState<string[]>([])
  const [input, setInput] = useState("")
  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const date = todayStr()

  // Load tags on mount
  useEffect(() => {
    fetch(`/api/daily-tags?date=${date}`)
      .then(r => r.json())
      .then((data: { date: string; tags: string[] }) => {
        setTags(data.tags ?? [])
      })
      .catch(() => {})
  }, [date])

  // Debounced auto-save
  const saveTags = useCallback((newTags: string[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        await fetch("/api/daily-tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, tags: newTags }),
        })
      } catch {}
      setSaving(false)
    }, 500)
  }, [date])

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().slice(0, 30)
    if (!tag || tags.includes(tag) || tags.length >= 10) return
    const next = [...tags, tag]
    setTags(next)
    saveTags(next)
  }

  function removeTag(tag: string) {
    const next = tags.filter(t => t !== tag)
    setTags(next)
    saveTags(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      addTag(input)
      setInput("")
    }
  }

  function handleAddClick() {
    addTag(input)
    setInput("")
  }

  const suggestions = QUICK_SUGGESTIONS.filter(s => !tags.includes(s))

  return (
    <div className="space-y-3">
      {/* Current tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <button
              key={tag}
              onClick={() => removeTag(tag)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${tagColor(tag)}`}
            >
              {tag}
              <span className="text-[10px] opacity-70">✕</span>
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-1.5">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length >= 10 ? "Max 10 tags reached" : "Add a tag…"}
          disabled={tags.length >= 10}
          className="h-8 text-sm bg-secondary/40 border-border/50 focus:border-primary/40"
          maxLength={30}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleAddClick}
          disabled={!input.trim() || tags.length >= 10}
          className="h-8 w-8 p-0 shrink-0"
          aria-label="Add tag"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Quick suggestions */}
      {suggestions.length > 0 && tags.length < 10 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => addTag(s)}
              className="px-2 py-0.5 rounded-full text-[11px] border border-dashed border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all"
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      {/* Saving indicator */}
      {saving && (
        <p className="text-[10px] text-muted-foreground/50">Saving…</p>
      )}
    </div>
  )
}
