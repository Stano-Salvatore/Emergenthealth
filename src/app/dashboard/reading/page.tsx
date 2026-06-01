"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BookOpen, BookMarked, Plus, Star, Trash2, Check, ChevronDown, ChevronUp } from "lucide-react"
import { EmptyState } from "@/components/ui/EmptyState"

interface Book {
  id: string
  title: string
  author: string | null
  pages: number | null
  status: string
  rating: number | null
  startedAt: string | null
  finishedAt: string | null
  notes: string | null
  coverColor: string
  createdAt: string
  updatedAt: string
}

const STATUS_LABELS: Record<string, string> = {
  reading: "Currently Reading",
  done: "Finished",
  wishlist: "Want to Read",
}

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9",
]

function StarRating({ value, onChange }: { value: number | null; onChange: (r: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange(n)} className="p-0.5">
          <Star
            className={`h-4 w-4 transition-colors ${n <= (value ?? 0) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
          />
        </button>
      ))}
    </div>
  )
}

function BookCard({ book, onUpdate, onDelete }: {
  book: Book
  onUpdate: (id: string, data: Partial<Book>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState(book.notes ?? "")
  const [saving, setSaving] = useState(false)

  async function saveNotes() {
    setSaving(true)
    await onUpdate(book.id, { notes })
    setSaving(false)
  }

  const startedLabel = book.startedAt
    ? new Date(book.startedAt).toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" })
    : null
  const finishedLabel = book.finishedAt
    ? new Date(book.finishedAt).toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" })
    : null

  return (
    <div className="flex gap-3 p-4 rounded-xl border bg-card hover:bg-secondary/20 transition-colors group">
      {/* Spine */}
      <div
        className="w-10 shrink-0 rounded-md flex items-center justify-center"
        style={{ backgroundColor: book.coverColor + "33", borderLeft: `3px solid ${book.coverColor}` }}
      >
        <BookOpen className="h-4 w-4" style={{ color: book.coverColor }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{book.title}</p>
            {book.author && <p className="text-xs text-muted-foreground truncate">{book.author}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {book.status !== "done" && (
              <button
                onClick={() => onUpdate(book.id, { status: "done" })}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-green-500/20 transition-all"
                title="Mark as done"
              >
                <Check className="h-3.5 w-3.5 text-green-500" />
              </button>
            )}
            {book.status !== "reading" && book.status !== "done" && (
              <button
                onClick={() => onUpdate(book.id, { status: "reading" })}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-500/20 transition-all text-xs text-blue-400 font-medium"
              >
                Read
              </button>
            )}
            <button
              onClick={() => onDelete(book.id)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 transition-all"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
            <button onClick={() => setExpanded(e => !e)} className="p-1">
              {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-1.5">
          <StarRating value={book.rating} onChange={r => onUpdate(book.id, { rating: r as unknown as number })} />
          {book.pages && <span className="text-xs text-muted-foreground">{book.pages}p</span>}
          {startedLabel && <span className="text-xs text-muted-foreground">Started {startedLabel}</span>}
          {finishedLabel && <span className="text-xs text-muted-foreground">Finished {finishedLabel}</span>}
        </div>

        {expanded && (
          <div className="mt-3 space-y-2">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes, quotes, thoughts…"
              rows={3}
              className="w-full text-sm rounded-lg border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" variant="outline" onClick={saveNotes} disabled={saving}>
              {saving ? "Saving…" : "Save notes"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function AddBookDialog({ onAdd }: { onAdd: (data: Partial<Book>) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [author, setAuthor] = useState("")
  const [pages, setPages] = useState("")
  const [status, setStatus] = useState("reading")
  const [color, setColor] = useState(COLORS[0])
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    await onAdd({ title: title.trim(), author: author.trim() || undefined, pages: pages ? parseInt(pages) : undefined, status, coverColor: color })
    setSaving(false)
    setOpen(false)
    setTitle(""); setAuthor(""); setPages(""); setStatus("reading"); setColor(COLORS[0])
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> Add Book
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-sm mx-4">
        <CardContent className="pt-6 space-y-4">
          <h2 className="font-semibold">Add a book</h2>
          <form onSubmit={submit} className="space-y-3">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Title *"
              required
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder="Author"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <input
                value={pages}
                onChange={e => setPages(e.target.value)}
                placeholder="Pages"
                type="number"
                min="1"
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="reading">Reading</option>
                <option value="wishlist">Wishlist</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Cover colour</p>
              <div className="flex gap-1.5 flex-wrap">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="h-6 w-6 rounded-full border-2 transition-all"
                    style={{ backgroundColor: c, borderColor: color === c ? "#fff" : "transparent" }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={saving} className="flex-1">{saving ? "Adding…" : "Add"}</Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function ReadingPage() {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/reading")
    if (res.ok) setBooks(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function addBook(data: Partial<Book>) {
    await fetch("/api/reading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    load()
  }

  async function updateBook(id: string, data: Partial<Book>) {
    await fetch(`/api/reading/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    load()
  }

  async function deleteBook(id: string) {
    await fetch(`/api/reading/${id}`, { method: "DELETE" })
    load()
  }

  const reading = books.filter(b => b.status === "reading")
  const done = books.filter(b => b.status === "done")
  const wishlist = books.filter(b => b.status === "wishlist")

  const avgRating = done.filter(b => b.rating).reduce((a, b, _, arr) => a + (b.rating ?? 0) / arr.filter(x => x.rating).length, 0)

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" /> Reading
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track your library</p>
        </div>
        <AddBookDialog onAdd={addBook} />
      </div>

      {/* Stats row */}
      {books.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-black text-blue-400">{reading.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Reading now</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-black text-green-400">{done.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Finished</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-black text-yellow-400">{avgRating ? avgRating.toFixed(1) : "—"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Avg rating</p>
            </CardContent>
          </Card>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl border bg-card animate-pulse" />)}
        </div>
      ) : books.length === 0 ? (
        <EmptyState
          icon={<BookMarked className="h-10 w-10" />}
          title="No books yet"
          description="Add books you're reading or want to read."
        />
      ) : (
        <>
          {reading.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Currently Reading</p>
                <Badge variant="secondary" className="text-[10px]">{reading.length}</Badge>
              </div>
              <div className="space-y-2">
                {reading.map(b => <BookCard key={b.id} book={b} onUpdate={updateBook} onDelete={deleteBook} />)}
              </div>
            </section>
          )}

          {wishlist.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Want to Read</p>
                <Badge variant="secondary" className="text-[10px]">{wishlist.length}</Badge>
              </div>
              <div className="space-y-2">
                {wishlist.map(b => <BookCard key={b.id} book={b} onUpdate={updateBook} onDelete={deleteBook} />)}
              </div>
            </section>
          )}

          {done.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Finished</p>
                <Badge variant="secondary" className="text-[10px]">{done.length}</Badge>
              </div>
              <div className="space-y-2">
                {done.map(b => <BookCard key={b.id} book={b} onUpdate={updateBook} onDelete={deleteBook} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
