"use client"

import { useEffect, useState } from "react"
import { Trash2, Lightbulb, Bug, Heart, MessageSquarePlus } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { Card, CardContent } from "@/components/ui/card"

type Feedback = {
  id: string
  userId: string
  message: string
  type: string
  createdAt: string
  email: string
  name: string
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  suggestion: <Lightbulb className="h-3.5 w-3.5 text-yellow-400" />,
  bug: <Bug className="h-3.5 w-3.5 text-red-400" />,
  praise: <Heart className="h-3.5 w-3.5 text-pink-400" />,
}

export function FeedbackInbox() {
  const [items, setItems] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch("/api/feedback")
      .then(async r => {
        if (r.status === 403) { setForbidden(true); return [] }
        const d = await r.json()
        return Array.isArray(d) ? d : []
      })
      .then(d => setItems(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (forbidden) return null

  async function remove(id: string) {
    setItems(prev => prev.filter(f => f.id !== id))
    await fetch("/api/feedback", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">User Feedback</p>
          {items.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
              {items.length}
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <MessageSquarePlus className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No feedback yet</p>
            <p className="text-xs text-muted-foreground/60">
              Users can submit suggestions, bug reports, or praise via the button in the dashboard.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(f => (
              <div
                key={f.id}
                className="group flex gap-3 rounded-xl border border-border/50 bg-secondary/20 px-3 py-3"
              >
                <span className="mt-0.5 shrink-0">{TYPE_ICON[f.type] ?? TYPE_ICON.suggestion}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm whitespace-pre-wrap break-words">{f.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {f.name || f.email} · {formatDistanceToNow(new Date(f.createdAt), { addSuffix: true })}
                  </p>
                </div>
                <button
                  onClick={() => remove(f.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-1 shrink-0 self-start"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
