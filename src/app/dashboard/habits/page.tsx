"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { CheckSquare, Flame, Plus, Check, Trash2 } from "lucide-react"

interface Habit {
  id: string
  name: string
  description: string | null
  color: string
  streak: number
  completedToday: boolean
  completions: { date: string }[]
}

const COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6",
]

export default function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState(COLORS[0])
  const [saving, setSaving] = useState(false)

  async function loadHabits() {
    const res = await fetch("/api/habits")
    if (res.ok) setHabits(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadHabits() }, [])

  async function createHabit(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    await fetch("/api/habits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, color: newColor }),
    })
    setNewName("")
    setFormOpen(false)
    setSaving(false)
    loadHabits()
  }

  async function toggleComplete(habit: Habit) {
    const url = `/api/habits/${habit.id}/complete`
    if (habit.completedToday) {
      await fetch(url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: new Date().toISOString().split("T")[0] }),
      })
    } else {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: new Date().toISOString().split("T")[0] }),
      })
    }
    loadHabits()
  }

  async function deleteHabit(id: string) {
    await fetch(`/api/habits/${id}`, { method: "DELETE" })
    loadHabits()
  }

  const completed = habits.filter((h) => h.completedToday).length
  const total = habits.length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Habits</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {total > 0 ? `${completed} / ${total} done today` : "Track daily habits"}
          </p>
        </div>
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> New Habit
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-sm">
            <DialogHeader>
              <DialogTitle>New Habit</DialogTitle>
            </DialogHeader>
            <form onSubmit={createHabit} className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  className="mt-1"
                  placeholder="Morning run"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      className="h-7 w-7 rounded-full border-2 transition-transform"
                      style={{
                        backgroundColor: c,
                        borderColor: newColor === c ? "white" : "transparent",
                        transform: newColor === c ? "scale(1.15)" : "scale(1)",
                      }}
                    />
                  ))}
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={saving || !newName.trim()}>
                {saving ? "Creating..." : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="h-4 bg-secondary rounded animate-pulse w-24 mb-2" />
                <div className="h-3 bg-secondary rounded animate-pulse w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : habits.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <CheckSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No habits yet</p>
            <p className="text-sm text-muted-foreground mt-1">Click &quot;New Habit&quot; to start tracking</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {habits.map((habit) => (
            <Card
              key={habit.id}
              className={`transition-colors ${
                habit.completedToday ? "border-green-500/30 bg-green-500/5" : ""
              }`}
            >
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: habit.color }}
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{habit.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Flame className="h-3 w-3 text-orange-400" />
                        <span className="text-xs text-muted-foreground">
                          {habit.streak} day streak
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => deleteHabit(habit.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => toggleComplete(habit)}
                      className={`h-8 w-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                        habit.completedToday
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-border hover:border-green-500"
                      }`}
                    >
                      {habit.completedToday && <Check className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Last 7 days mini grid */}
                <div className="flex gap-1 mt-3">
                  {[...Array(7)].map((_, i) => {
                    const d = new Date()
                    d.setDate(d.getDate() - (6 - i))
                    const dateStr = d.toISOString().split("T")[0]
                    const done = habit.completions?.some((c) => c.date?.startsWith(dateStr))
                    return (
                      <div
                        key={i}
                        className="h-2 flex-1 rounded-sm"
                        style={{ backgroundColor: done ? habit.color : "var(--secondary)" }}
                        title={dateStr}
                      />
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
