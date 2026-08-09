"use client"

import { useEffect, useRef, useState } from "react"
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

// Due dates are stored at UTC midnight, so the date part of the stored string
// *is* the intended calendar day. Turning it back into a Date and comparing
// against local time shifted it: west of Greenwich a reminder due the 9th read
// as the 8th and showed up overdue a day early.
function dueDay(dueDate: string | null): string | null {
  return dueDate ? dueDate.slice(0, 10) : null
}

function todayStr(): string {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-")
}

// A reminder is due until the end of its day, so today's are never overdue.
function isOverdue(dueDate: string | null) {
  const day = dueDay(dueDate)
  return day != null && day < todayStr()
}

function isToday(dueDate: string | null) {
  return dueDay(dueDate) === todayStr()
}

// Format the stored day without letting a timezone shift it.
function formatDueDate(dueDate: string): string {
  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  })
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
  const [loadError, setLoadError] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: "", description: "", dueDate: "", priority: "normal", tags: [] as string[], reminderTime: "",
  })
  const [newTagName, setNewTagName] = useState("")
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const [rRes, tRes] = await Promise.all([fetch("/api/reminders"), fetch("/api/tags")])
      if (!rRes.ok) throw new Error(String(rRes.status))
      setReminders(await rRes.json())
      if (tRes.ok) setAllTags(await tRes.json())
      setLoadError(false)
    } catch {
      // Without this the rejected fetch left the skeletons up for good.
      setLoadError(true)
    } finally {
      setLoading(false)
    }
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

  // First tap arms, second within 4s deletes — a single tap used to remove a
  // reminder outright, with no undo.
  async function deleteReminder(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(() => setConfirmDelete(null), 4000)
      return
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setConfirmDelete(null)
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
            {formatDueDate(r.dueDate)}
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
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Priority used to render only for "high" — Normal and Low were
            settable but never appeared anywhere. */}
        {r.priority === "high" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400" title="High priority">
            <AlertCircle className="h-3.5 w-3.5" /> High
          </span>
        )}
        {r.priority === "low" && (
          <span className="text-[10px] text-muted-foreground/70" title="Low priority">Low</span>
        )}
        <button onClick={() => deleteReminder(r.id)}
          aria-label={confirmDelete === r.id ? `Confirm deleting ${r.title}` : `Delete ${r.title}`}
          className={`transition-colors p-1 rounded-md ${
            confirmDelete === r.id ? "text-destructive bg-destructive/15" : "text-muted-foreground/60 hover:text-destructive"
          }`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
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
      ) : loadError ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Bell className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">Couldn&apos;t load your reminders</p>
            <p className="text-xs text-muted-foreground mt-1">Nothing was lost — this is just the list.</p>
            <Button size="sm" className="mt-4" onClick={() => { setLoading(true); load() }}>Try again</Button>
          </CardContent>
        </Card>
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
