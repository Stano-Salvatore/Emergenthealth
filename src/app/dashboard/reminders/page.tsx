"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
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
import { Bell, Plus, Check, Trash2, AlertCircle, Clock } from "lucide-react"

interface Reminder {
  id: string
  title: string
  description: string | null
  dueDate: string | null
  isCompleted: boolean
  priority: string
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400",
  normal: "text-yellow-400",
  low: "text-muted-foreground",
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

function isToday(dueDate: string | null) {
  if (!dueDate) return false
  const d = new Date(dueDate)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ title: "", description: "", dueDate: "", priority: "normal" })
  const [saving, setSaving] = useState(false)

  async function load() {
    const res = await fetch("/api/reminders")
    if (res.ok) setReminders(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function createReminder(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        description: form.description || undefined,
        dueDate: form.dueDate || undefined,
        priority: form.priority,
      }),
    })
    setForm({ title: "", description: "", dueDate: "", priority: "normal" })
    setFormOpen(false)
    setSaving(false)
    load()
  }

  async function toggleComplete(r: Reminder) {
    await fetch(`/api/reminders/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCompleted: !r.isCompleted }),
    })
    load()
  }

  async function deleteReminder(id: string) {
    await fetch(`/api/reminders/${id}`, { method: "DELETE" })
    load()
  }

  const active = reminders.filter((r) => !r.isCompleted)
  const completed = reminders.filter((r) => r.isCompleted)
  const overdue = active.filter((r) => isOverdue(r.dueDate))
  const today = active.filter((r) => !isOverdue(r.dueDate) && isToday(r.dueDate))
  const upcoming = active.filter((r) => !isOverdue(r.dueDate) && !isToday(r.dueDate))

  const ReminderCard = ({ r }: { r: Reminder }) => (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <button
        onClick={() => toggleComplete(r)}
        className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          r.isCompleted
            ? "bg-green-500 border-green-500 text-white"
            : "border-border hover:border-green-500"
        }`}
      >
        {r.isCompleted && <Check className="h-3 w-3" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${r.isCompleted ? "line-through text-muted-foreground" : ""}`}>
          {r.title}
        </p>
        {r.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.description}</p>
        )}
        {r.dueDate && (
          <p className={`flex items-center gap-1 text-xs mt-0.5 ${isOverdue(r.dueDate) && !r.isCompleted ? "text-red-400" : "text-muted-foreground"}`}>
            <Clock className="h-3 w-3" />
            {new Date(r.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {isOverdue(r.dueDate) && !r.isCompleted && " · Overdue"}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className={`${PRIORITY_COLORS[r.priority]}`}>
          {r.priority === "high" && <AlertCircle className="h-3.5 w-3.5" />}
        </span>
        <button
          onClick={() => deleteReminder(r.id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reminders</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {overdue.length > 0 ? `${overdue.length} overdue` : `${active.length} pending`}
          </p>
        </div>
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> New Reminder
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-sm">
            <DialogHeader>
              <DialogTitle>New Reminder</DialogTitle>
            </DialogHeader>
            <form onSubmit={createReminder} className="space-y-3">
              <div>
                <Label>Title</Label>
                <Input
                  className="mt-1"
                  placeholder="What do you need to remember?"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input
                  className="mt-1"
                  placeholder="Additional details"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <Label>Due date (optional)</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div>
                <Label>Priority</Label>
                <div className="flex gap-2 mt-1">
                  {["low", "normal", "high"].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, priority: p }))}
                      className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                        form.priority === p
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={saving || !form.title.trim()}>
                {saving ? "Creating..." : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-4">
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-4 bg-secondary rounded animate-pulse" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : reminders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Bell className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No reminders</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {overdue.length > 0 && (
            <Card className="border-red-500/30">
              <CardContent className="px-5 py-0">
                <p className="text-xs font-medium text-red-400 pt-3 pb-1">Overdue</p>
                {overdue.map((r) => <ReminderCard key={r.id} r={r} />)}
              </CardContent>
            </Card>
          )}
          {today.length > 0 && (
            <Card>
              <CardContent className="px-5 py-0">
                <p className="text-xs font-medium text-yellow-400 pt-3 pb-1">Today</p>
                {today.map((r) => <ReminderCard key={r.id} r={r} />)}
              </CardContent>
            </Card>
          )}
          {upcoming.length > 0 && (
            <Card>
              <CardContent className="px-5 py-0">
                <p className="text-xs font-medium text-muted-foreground pt-3 pb-1">Upcoming</p>
                {upcoming.map((r) => <ReminderCard key={r.id} r={r} />)}
              </CardContent>
            </Card>
          )}
          {completed.length > 0 && (
            <Card className="opacity-60">
              <CardContent className="px-5 py-0">
                <p className="text-xs font-medium text-muted-foreground pt-3 pb-1">Completed</p>
                {completed.slice(0, 5).map((r) => <ReminderCard key={r.id} r={r} />)}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
