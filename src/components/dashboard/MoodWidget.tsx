"use client"

import { useEffect, useState } from "react"

const MOODS = [
  { value: 1, emoji: "😴", label: "Awful" },
  { value: 2, emoji: "😕", label: "Bad" },
  { value: 3, emoji: "😐", label: "OK" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "😄", label: "Great" },
]

interface MoodWidgetProps {
  todayMood: number | null
}

export function MoodWidget({ todayMood: initialMood }: MoodWidgetProps) {
  const [selected, setSelected] = useState<number | null>(initialMood)
  const [saving, setSaving] = useState(false)

  async function saveMood(mood: number) {
    if (saving) return
    setSaving(true)
    setSelected(mood)
    try {
      await fetch("/api/mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood }),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-1">
      {MOODS.map(m => (
        <button
          key={m.value}
          onClick={() => saveMood(m.value)}
          title={m.label}
          className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all text-center ${
            selected === m.value
              ? "bg-primary/20 ring-1 ring-primary scale-105"
              : "hover:bg-secondary"
          }`}
        >
          <span className="text-xl leading-none">{m.emoji}</span>
          <span className="text-[9px] text-muted-foreground">{m.label}</span>
        </button>
      ))}
    </div>
  )
}
