"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Bell, Plus, Check, Trash2, AlertCircle, Clock, Tag, X } from "lucide-react"

interface Reminder {
  id: string
  title: string
  description: string | null
  dueDate: string | null
  isCompleted: boolean
  priority: string
  tags: string[]
  reminderTime?: string | null
}

interface TagItem {
  id: string
  name: string
  color: string
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400",
  normal: "text-yellow-400",
  low: "text-muted-foreground",
}

const TAG_COLORS = [
  "#6366f1","#22c55e","#f59e0b","#ef4444",
  "#8b5cf6","#06b6d4","#ec4899","#14b8a6",
]

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false
  // Treat due date as end-of-day so today's reminders aren't immediately "overdue"
  const d = new Date(dueDate)
  d.setHours(23, 59, 59, 999)
  return d < new Date()
}

function isToday(dueDate: string | null) {
  if (!dueDate) return false
  return new Date(dueDate).toDateString() === new Date().toDateString()
}

function TagChip({ name, color, onRemove }: { name: string; color: string; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: color + "22", color, border: `1px solid ${color}44` }}
    >
      {name}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-70 ml-0.5">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  )
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [allTags, setAllTags] = useState<TagItem[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: "", description: "", dueDate: "", priority: "normal", tags: [] as string[], reminderTime: "",
  })
  const [newTagName, setNewTagName] = useState("")
  const [saving, setSaving] = useState(false)

  async function load() {
    const [rRes, tRes] = await Promise.all([fetch("/api/reminders"), fetch("/api/tags")])
    if (rRes.ok) setReminders(await rRes.json())
    if (tRes.ok) setAllTags(await tRes.json())
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
        tags: form.tags,
        reminderTime: form.reminderTime || undefined,
      }),
    })
    setForm({ title: "", description: "", dueDate: "", priority: "normal", tags: [], reminderTime: "" })
    setFormOpen(false)
    setSaving(false)
    load()
  }

  async function addNewTag() {
    if (!newTagName.trim()) return
    const color = TAG_COLORS[allTags.length % TAG_COLORS.length]
    await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTagName.trim(), color }),
    })
    setNewTagName("")
    load()
  }

  function toggleFormTag(name: string) {
    setForm(f => ({
      ...f,
      tags: f.tags.includes(name) ? f.tags.filter(t => t !== name) : [...f.tags, name],
    }))
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

  const active = reminders.filter(r => !r.isCompleted)
  const completed = reminders.filter(r => r.isCompleted)
  const filtered = (arr: Reminder[]) => filterTag ? arr.filter(r => r.tags.includes(filterTag)) : arr
  const overdue = filtered(active.filter(r => isOverdue(r.dueDate)))
  const today = filtered(active.filter(r => !isOverdue(r.dueDate) && isToday(r.dueDate)))
  const upcoming = filtered(active.filter(r => !isOverdue(r.dueDate) && !isToday(r.dueDate)))

  const usedTagNames = [...new Set(reminders.flatMap(r => r.tags))]

  const ReminderCard = ({ r }: { r: Reminder }) => (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <button
        onClick={() => toggleComplete(r)}
        className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          r.isCompleted ? "bg-green-500 border-green-500 text-white" : "border-border hover:border-green-500"
        }`}
      >
        {r.isCompleted && <Check className="h-3 w-3" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${r.isCompleted ? "line-through text-muted-foreground" : ""}`}>{r.title}</p>
        {r.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.description}</p>}
        {r.dueDate && (
          <p className={`flex items-center gap-1 text-xs mt-0.5 ${isOverdue(r.dueDate) && !r.isCompleted ? "text-red-400" : "text-muted-foreground"}`}>
            <Clock className="h-3 w-3" />
            {new Date(r.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {isOverdue(r.dueDate) && !r.isCompleted && " · Overdue"}
            {r.reminderTime && <span className="ml-1">🔔 {r.reminderTime}</span>}
          </p>
        )}
        {r.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {r.tags.map(tag => {
              const tagItem = allTags.find(t => t.name === tag)
              return <TagChip key={tag} name={tag} color={tagItem?.color ?? "#6366f1"} />
            })}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className={PRIORITY_COLORS[r.priority]}>
          {r.priority === "high" && <AlertCircle className="h-3.5 w-3.5" />}
        </span>
        <button onClick={() => deleteReminder(r.id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-1">
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
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New Reminder</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-sm">
            <DialogHeader><DialogTitle>New Reminder</DialogTitle></DialogHeader>
            <form onSubmit={createReminder} className="space-y-3">
              <div>
                <Label>Title</Label>
                <Input className="mt-1" placeholder="What do you need to remember?"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus />
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input className="mt-1" placeholder="Additional details"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              {/* Quick picks */}
              <div>
                <Label>When</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {[
                    { label: "15 min", mins: 15 },
                    { label: "1 hour", mins: 60 },
                    { label: "3 hours", mins: 180 },
                    { label: "Tonight 9pm", mins: null, fixed: { h: 21, m: 0 } },
                    { label: "Tomorrow 9am", mins: null, fixed: { h: 9, m: 0, dayOffset: 1 } },
                  ].map(opt => {
                    function applyQuickPick() {
                      const now = new Date()
                      let target: Date
                      if (opt.mins !== null) {
                        target = new Date(now.getTime() + opt.mins * 60000)
                      } else {
                        target = new Date(now)
                        if (opt.fixed!.dayOffset) target.setDate(target.getDate() + opt.fixed!.dayOffset)
                        target.setHours(opt.fixed!.h, opt.fixed!.m, 0, 0)
                      }
                      const dateStr = target.toLocaleDateString("en-CA")
                      const timeStr = `${String(target.getHours()).padStart(2,"0")}:${String(target.getMinutes()).padStart(2,"0")}`
                      setForm(f => ({ ...f, dueDate: dateStr, reminderTime: timeStr }))
                    }
                    return (
                      <button key={opt.label} type="button" onClick={applyQuickPick}
                        className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Date</Label>
                  <Input type="date" className="mt-1" value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Time</Label>
                  <input type="time" value={form.reminderTime}
                    onChange={e => setForm(f => ({ ...f, reminderTime: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <Label>Priority</Label>
                <div className="flex gap-2 mt-1">
                  {["low","normal","high"].map(p => (
                    <button key={p} type="button" onClick={() => setForm(f => ({ ...f, priority: p }))}
                      className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                        form.priority===p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}>
                      {p.charAt(0).toUpperCase()+p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {/* Tags */}
              {allTags.length > 0 && (
                <div>
                  <Label>Tags</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {allTags.map(tag => (
                      <button key={tag.id} type="button" onClick={() => toggleFormTag(tag.name)}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                          form.tags.includes(tag.name) ? "opacity-100" : "opacity-50 hover:opacity-75"
                        }`}
                        style={{ backgroundColor: tag.color+"22", borderColor: tag.color+"66", color: tag.color }}>
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={saving || !form.title.trim()}>
                {saving ? "Creating..." : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tag filter + management */}
      {(allTags.length > 0 || true) && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <button onClick={() => setFilterTag(null)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  filterTag===null ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"
                }`}>All</button>
              {usedTagNames.map(name => {
                const tagItem = allTags.find(t => t.name === name)
                return (
                  <button key={name} onClick={() => setFilterTag(filterTag===name ? null : name)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      filterTag===name ? "opacity-100" : "opacity-60 hover:opacity-90"
                    }`}
                    style={{ backgroundColor: (tagItem?.color??"#6366f1")+"22", borderColor: (tagItem?.color??"#6366f1")+"66", color: tagItem?.color??"#6366f1" }}>
                    {name}
                  </button>
                )
              })}
              {/* New tag inline */}
              <div className="flex items-center gap-1 ml-auto">
                <Input
                  className="h-7 text-xs w-28"
                  placeholder="New tag…"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter") { e.preventDefault(); addNewTag() }}}
                />
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={addNewTag} disabled={!newTagName.trim()}>
                  Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card><CardContent className="py-4 px-5 animate-pulse">
          <div className="space-y-4">
            {[...Array(3)].map((_,i) => (
              <div key={i} className="flex items-start gap-3 py-1">
                <div className="mt-0.5 h-5 w-5 rounded-full bg-secondary shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 bg-secondary rounded w-3/4" />
                  <div className="h-3 bg-secondary rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      ) : reminders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Bell className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-medium text-muted-foreground mb-1">No reminders yet</p>
            <p className="text-xs text-muted-foreground/60 mb-4">Add things you need to remember — with due dates and priority</p>
            <button
              onClick={() => setFormOpen(true)}
              className="text-xs text-primary hover:underline"
            >
              + Add your first reminder
            </button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {overdue.length > 0 && (
            <Card className="border-red-500/30">
              <CardContent className="px-5 py-0">
                <p className="text-xs font-medium text-red-400 pt-3 pb-1">Overdue</p>
                {overdue.map(r => <ReminderCard key={r.id} r={r} />)}
              </CardContent>
            </Card>
          )}
          {today.length > 0 && (
            <Card>
              <CardContent className="px-5 py-0">
                <p className="text-xs font-medium text-yellow-400 pt-3 pb-1">Today</p>
                {today.map(r => <ReminderCard key={r.id} r={r} />)}
              </CardContent>
            </Card>
          )}
          {upcoming.length > 0 && (
            <Card>
              <CardContent className="px-5 py-0">
                <p className="text-xs font-medium text-muted-foreground pt-3 pb-1">Upcoming</p>
                {upcoming.map(r => <ReminderCard key={r.id} r={r} />)}
              </CardContent>
            </Card>
          )}
          {completed.length > 0 && (
            <Card className="opacity-60">
              <CardContent className="px-5 py-0">
                <p className="text-xs font-medium text-muted-foreground pt-3 pb-1">Completed</p>
                {completed.slice(0,5).map(r => <ReminderCard key={r.id} r={r} />)}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
