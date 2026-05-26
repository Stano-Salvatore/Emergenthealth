"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { format, subDays } from "date-fns"
import { BookOpen, MapPin, Plus, Trash2, ChevronLeft, ChevronRight, Check } from "lucide-react"

const MOODS = [
  { value: 1, emoji: "😴", label: "Awful" },
  { value: 2, emoji: "😕", label: "Bad" },
  { value: 3, emoji: "😐", label: "OK" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "😄", label: "Great" },
]

const PLACE_EMOJIS = ["📍","🏠","🏢","☕","🏋️","🛒","🍽️","🌳","✈️","🏥","📚","🎯"]

interface CheckIn {
  id: string
  place: string
  emoji: string
  note: string | null
  checkedAt: string
}

interface MoodEntry {
  mood: number
  note: string | null
}

interface DailyNote {
  content: string
}

export default function JournalPage() {
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])
  const [mood, setMood] = useState<MoodEntry | null>(null)
  const [note, setNote] = useState<DailyNote>({ content: "" })
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [checkIns, setCheckIns] = useState<CheckIn[]>([])
  const [newPlace, setNewPlace] = useState("")
  const [newEmoji, setNewEmoji] = useState("📍")
  const [newPlaceNote, setNewPlaceNote] = useState("")
  const [addingCheckIn, setAddingCheckIn] = useState(false)

  const isToday = date === new Date().toISOString().split("T")[0]

  async function loadDay(d: string) {
    const dayStart = d
    const dayEnd = new Date(new Date(d + "T23:59:59").toISOString()).toISOString()

    const [moodRes, noteRes, checkinsRes] = await Promise.all([
      fetch(`/api/mood?days=1`),
      fetch(`/api/daily-note?date=${d}`),
      fetch(`/api/checkins?since=${d}T00:00:00Z&limit=50`),
    ])

    if (moodRes.ok) {
      const moods = await moodRes.json()
      const todayMood = moods.find((m: any) => m.date?.startsWith(d))
      setMood(todayMood ?? null)
    }
    if (noteRes.ok) setNote(await noteRes.json())
    if (checkinsRes.ok) {
      const all: CheckIn[] = await checkinsRes.json()
      setCheckIns(all.filter(c => c.checkedAt.startsWith(d)))
    }
    setNoteSaveState("idle")
  }

  useEffect(() => { loadDay(date) }, [date])

  function changeDay(delta: number) {
    const d = new Date(date)
    d.setDate(d.getDate() + delta)
    const str = d.toISOString().split("T")[0]
    if (str <= new Date().toISOString().split("T")[0]) setDate(str)
  }

  async function saveMood(value: number) {
    await fetch("/api/mood", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mood: value, date }),
    })
    setMood({ mood: value, note: null })
  }

  async function saveNote(content: string, forDate: string) {
    setNoteSaveState("saving")
    await fetch("/api/daily-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, date: forDate }),
    })
    setNoteSaveState("saved")
  }

  function handleNoteChange(content: string) {
    setNote({ content })
    setNoteSaveState("idle")
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => saveNote(content, date), 2000)
  }

  async function addCheckIn(e: React.FormEvent) {
    e.preventDefault()
    if (!newPlace.trim()) return
    await fetch("/api/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: newPlace.trim(), emoji: newEmoji, note: newPlaceNote || null }),
    })
    setNewPlace("")
    setNewPlaceNote("")
    setNewEmoji("📍")
    setAddingCheckIn(false)
    loadDay(date)
  }

  async function deleteCheckIn(id: string) {
    await fetch("/api/checkins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    setCheckIns(c => c.filter(x => x.id !== id))
  }

  const displayDate = new Date(date + "T12:00:00")

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* header + date nav */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" /> Journal
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Daily reflection & location log</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => changeDay(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold px-2 min-w-[130px] text-center">
            {isToday ? "Today" : format(displayDate, "EEEE, MMM d")}
          </span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => changeDay(1)} disabled={isToday}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* mood */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">How did you feel?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {MOODS.map(m => (
              <button key={m.value} onClick={() => saveMood(m.value)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${
                  mood?.mood === m.value
                    ? "bg-primary/15 border-primary scale-105"
                    : "border-border hover:bg-secondary hover:scale-105"
                }`}>
                <span className="text-2xl">{m.emoji}</span>
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* daily note */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span>Daily Note</span>
            <span className={`text-[10px] transition-opacity duration-300 ${noteSaveState === "idle" ? "opacity-0" : "opacity-100"}`}>
              {noteSaveState === "saving" && <span className="text-muted-foreground">Saving…</span>}
              {noteSaveState === "saved" && <span className="text-green-400 flex items-center gap-1"><Check className="h-3 w-3" />Saved</span>}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className="w-full min-h-[120px] bg-secondary/30 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground leading-relaxed"
            placeholder={isToday ? "What's on your mind today? Wins, learnings, gratitude…" : "No note for this day."}
            value={note.content}
            onChange={e => handleNoteChange(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">Auto-saves as you type</p>
        </CardContent>
      </Card>

      {/* check-ins */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-rose-400" /> Where were you?
            </span>
            {isToday && (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
                onClick={() => setAddingCheckIn(v => !v)}>
                <Plus className="h-3 w-3" /> Check in
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isToday && addingCheckIn && (
            <form onSubmit={addCheckIn} className="rounded-lg border bg-secondary/20 p-3 space-y-2">
              <div className="flex flex-wrap gap-1.5 mb-1">
                {PLACE_EMOJIS.map(e => (
                  <button key={e} type="button" onClick={() => setNewEmoji(e)}
                    className={`text-lg p-1 rounded transition-all ${newEmoji===e ? "bg-primary/20 ring-1 ring-primary scale-110" : "hover:bg-secondary"}`}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input placeholder="Place name (e.g. Office)" value={newPlace}
                  onChange={e => setNewPlace(e.target.value)} className="flex-1" autoFocus />
                <Button type="submit" size="sm" disabled={!newPlace.trim()}>Add</Button>
              </div>
              <Input placeholder="Note (optional)" value={newPlaceNote}
                onChange={e => setNewPlaceNote(e.target.value)} />
            </form>
          )}

          {checkIns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No check-ins recorded for this day.</p>
          ) : (
            <div className="space-y-0">
              {checkIns.map((c, i) => (
                <div key={c.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <span className="text-xl">{c.emoji}</span>
                    {i < checkIns.length - 1 && <div className="w-px h-full bg-border min-h-[12px]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{c.place}</p>
                    {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {format(new Date(c.checkedAt), "HH:mm")}
                    </p>
                  </div>
                  <button onClick={() => deleteCheckIn(c.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* recent days nav */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-medium">Recent days</p>
        <div className="flex gap-2 flex-wrap">
          {[0,1,2,3,4,5,6].map(d => {
            const dd = subDays(new Date(), d)
            const str = dd.toISOString().split("T")[0]
            return (
              <button key={str} onClick={() => setDate(str)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  date===str ? "bg-primary/15 border-primary text-primary font-medium" : "border-border text-muted-foreground hover:border-muted-foreground"
                }`}>
                {d===0 ? "Today" : d===1 ? "Yesterday" : format(dd,"EEE d")}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
