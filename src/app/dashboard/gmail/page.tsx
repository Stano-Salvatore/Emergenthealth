"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Mail, RefreshCw, AlertCircle } from "lucide-react"
import { format, parseISO, isToday, isYesterday } from "date-fns"
import { ReconnectGoogleButton } from "@/components/ui/ReconnectGoogleButton"

interface GmailMessage {
  id: string
  subject: string
  from: string
  fromName: string
  snippet: string
  date: string
  isUnread: boolean
}

interface GmailData {
  unreadCount: number
  messages: GmailMessage[]
  error?: string
}

function formatEmailDate(dateStr: string) {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    if (isToday(d)) return format(d, "h:mm a")
    if (isYesterday(d)) return "Yesterday"
    return format(d, "MMM d")
  } catch {
    return dateStr
  }
}

function getInitials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("")
}

function avatarColor(name: string) {
  const colors = [
    "bg-blue-500","bg-violet-500","bg-emerald-500","bg-amber-500",
    "bg-rose-500","bg-cyan-500","bg-orange-500","bg-pink-500",
  ]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}

export default function GmailPage() {
  const [data, setData] = useState<GmailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<GmailMessage | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/gmail")
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const authError = !!data?.error
  const noGmailAccess = !authError && data?.unreadCount === 0 && data?.messages.length === 0

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-rose-400" /> Gmail
          </h1>
          {data && (
            <p className="text-muted-foreground text-sm mt-0.5">
              {data.unreadCount > 0 ? `${data.unreadCount} unread` : "Inbox"} · {data.messages.length} messages
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 px-4 py-3 rounded-xl border border-red-500/20">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Could not load Gmail</p>
            <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {authError && !loading && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="py-10 text-center space-y-3">
            <AlertCircle className="h-8 w-8 text-amber-400 mx-auto" />
            <div>
              <p className="font-medium">Gmail access expired</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                Your Google session needs to be refreshed to read your inbox.
              </p>
            </div>
            <ReconnectGoogleButton label="Reconnect Google" />
          </CardContent>
        </Card>
      )}

      {noGmailAccess && !error && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">Gmail access not granted</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              Sign out and sign back in to grant Gmail read access. It&apos;s needed to show your inbox here.
            </p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="space-y-2">
          {[...Array(6)].map((_,i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border animate-pulse">
              <div className="h-9 w-9 rounded-full bg-secondary shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-secondary rounded w-32" />
                <div className="h-3 bg-secondary rounded w-48" />
                <div className="h-2 bg-secondary rounded w-full max-w-sm" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && data && data.messages.length > 0 && (
        <div className="flex gap-4">
          {/* message list */}
          <div className="flex-1 min-w-0 space-y-1">
            {data.messages.map(m => (
              <button key={m.id} onClick={() => setSelected(selected?.id === m.id ? null : m)}
                className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl border transition-all hover:bg-secondary/50 ${
                  selected?.id === m.id ? "bg-primary/5 border-primary/30" : m.isUnread ? "bg-card border-border font-[450]" : "bg-card/50 border-border/50"
                }`}>
                <div className={`h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 ${avatarColor(m.fromName)}`}>
                  {getInitials(m.fromName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${m.isUnread ? "font-semibold" : "text-muted-foreground"}`}>
                      {m.fromName}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatEmailDate(m.date)}</span>
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${m.isUnread ? "text-foreground" : "text-muted-foreground"}`}>{m.subject}</p>
                  <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{m.snippet}</p>
                </div>
                {m.isUnread && <div className="h-2 w-2 rounded-full bg-rose-400 shrink-0 mt-1.5" />}
              </button>
            ))}
          </div>

          {/* detail panel */}
          {selected && (
            <div className="w-80 shrink-0 hidden lg:block">
              <Card className="sticky top-4">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${avatarColor(selected.fromName)}`}>
                      {getInitials(selected.fromName)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{selected.fromName}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{selected.from}</p>
                    </div>
                    {selected.isUnread && <Badge className="ml-auto shrink-0 bg-rose-500 text-[9px] px-1.5 py-0 hover:bg-rose-500">Unread</Badge>}
                  </div>
                  <div className="border-t pt-3">
                    <p className="text-sm font-medium leading-snug">{selected.subject}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{formatEmailDate(selected.date)}</p>
                  </div>
                  <div className="border-t pt-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">{selected.snippet}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground italic">Open Gmail to read the full message</p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
