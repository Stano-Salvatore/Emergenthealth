"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RefreshCw, Trash2, Music, AlertCircle, Radio } from "lucide-react"

interface LastfmLogRow {
  id: string
  userId: string
  date: string
  tracksPlayed: number
  listeningMin: number
  topArtist: string | null
  topTrack: string | null
}

interface LastfmData {
  hasKey: boolean
  username: string | null
  logs: LastfmLogRow[]
}

// --- helpers ----------------------------------------------------------------

function fmtDate(dateStr: string) {
  try {
    const d = new Date(dateStr + "T00:00:00")
    return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" })
  } catch {
    return dateStr
  }
}

function fmtHours(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Build array of last N calendar days (YYYY-MM-DD) ending today */
function lastNDays(n: number): string[] {
  const days: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

// --- Connect form -----------------------------------------------------------

function ConnectForm({ onSaved }: { onSaved: () => void }) {
  const [apiKey, setApiKey] = useState("")
  const [username, setUsername] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim() || !username.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/lastfm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", apiKey: apiKey.trim(), username: username.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to save")
      }
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 px-8 py-14 text-center max-w-md mx-auto">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
        <Music className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-semibold">Connect Last.fm</h3>
      <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
        Enter your Last.fm API key and username to start tracking your listening history.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 w-full space-y-3 text-left">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            API Key
          </label>
          <Input
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            required
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">
            Get your API key at{" "}
            <a
              href="https://www.last.fm/api/account/create"
              target="_blank"
              rel="noopener noreferrer"
              className="text-rose-400 hover:underline"
            >
              last.fm/api
            </a>
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Username
          </label>
          <Input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="your_lastfm_username"
            required
            autoComplete="off"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <Button type="submit" disabled={saving} className="w-full mt-1">
          {saving ? "Saving…" : "Connect"}
        </Button>
      </form>
    </div>
  )
}

// --- Bar chart (CSS only) ---------------------------------------------------

function ListeningChart({ logs }: { logs: LastfmLogRow[] }) {
  const days = lastNDays(14)
  const logMap = Object.fromEntries(logs.map(l => [l.date.slice(0, 10), l]))
  const values = days.map(d => logMap[d]?.tracksPlayed ?? 0)
  const max = Math.max(...values, 1)

  return (
    <div>
      <div className="flex items-end gap-1 h-28">
        {days.map((d, i) => {
          const v = values[i]
          const pct = v / max
          const isToday = d === new Date().toISOString().slice(0, 10)
          return (
            <div key={d} className="flex-1 flex flex-col items-center gap-1 group relative">
              {/* tooltip */}
              <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
                <div className="rounded-lg bg-popover border border-border text-[10px] px-2 py-1 whitespace-nowrap shadow-md">
                  <span className="font-semibold">{v} tracks</span>
                  <span className="text-muted-foreground ml-1">{fmtDate(d)}</span>
                </div>
                <div className="h-1.5 w-px bg-border" />
              </div>

              {/* bar */}
              <div className="w-full rounded-t-sm transition-all" style={{
                height: `${Math.max(pct * 100, v > 0 ? 4 : 0)}%`,
                backgroundColor: isToday
                  ? "rgb(251 113 133)" /* rose-400 */
                  : v > 0
                  ? "rgb(244 63 94 / 0.55)" /* rose-500/55 */
                  : "rgb(255 255 255 / 0.04)",
              }} />
            </div>
          )
        })}
      </div>
      {/* x-axis labels — show every other */}
      <div className="flex gap-1 mt-1">
        {days.map((d, i) => (
          <div key={d} className="flex-1 text-center text-[9px] text-muted-foreground/60">
            {i % 2 === 0 ? fmtDate(d) : ""}
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Connected dashboard ----------------------------------------------------

function Dashboard({
  data,
  onRefresh,
}: {
  data: LastfmData
  onRefresh: () => void
}) {
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const logs = data.logs

  // Summary stats
  const totalTracks = logs.reduce((s, l) => s + l.tracksPlayed, 0)
  const totalMins = logs.reduce((s, l) => s + l.listeningMin, 0)
  const avgPerDay = logs.length > 0 ? Math.round(totalTracks / 30) : 0

  // Most played artist
  const artistCounts: Record<string, number> = {}
  for (const l of logs) {
    if (l.topArtist) artistCounts[l.topArtist] = (artistCounts[l.topArtist] ?? 0) + 1
  }
  const topArtistEntry = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0]
  const topArtist = topArtistEntry ? topArtistEntry[0] : "—"

  // Top artists list
  const sortedArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch("/api/lastfm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? "Sync failed")
      }
      onRefresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Last.fm and remove all sync data?")) return
    setDisconnecting(true)
    try {
      await fetch("/api/lastfm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      })
      onRefresh()
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-rose-400" />
            Last.fm
          </h1>
          {data.username && (
            <p className="text-muted-foreground text-sm mt-0.5">
              @{data.username} · last 30 days
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Disconnect
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 px-4 py-3 rounded-xl border border-red-500/20">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {logs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Music className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No listening data yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              Hit Sync to pull your recent scrobbles from Last.fm.
            </p>
            <Button size="sm" className="mt-4" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-black text-rose-400">{totalTracks.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Tracks (30 days)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-black text-violet-400">{fmtHours(totalMins)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Listening time</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-black text-sky-400">{avgPerDay}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Avg tracks / day</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-base font-black text-emerald-400 truncate" title={topArtist}>{topArtist}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Top artist</p>
              </CardContent>
            </Card>
          </div>

          {/* Listening bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Tracks per day — last 14 days
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-4">
              <ListeningChart logs={logs} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Top artists */}
            {sortedArtists.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Top Artists
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-4 space-y-2">
                  {sortedArtists.map(([artist, days], i) => {
                    const pct = Math.round((days / (sortedArtists[0][1] ?? 1)) * 100)
                    return (
                      <div key={artist} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-3 text-right shrink-0">{i + 1}</span>
                            <span className="font-medium truncate max-w-[160px]" title={artist}>{artist}</span>
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0 ml-2">
                            {days} {days === 1 ? "day" : "days"}
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-rose-500/70 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )}

            {/* Recent history placeholder if only 1 column */}
            <div className="sm:col-span-1" />
          </div>

          {/* Recent history table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Recent History
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Date</th>
                    <th className="text-right py-2 pr-4 text-xs text-muted-foreground font-medium">Tracks</th>
                    <th className="text-right py-2 pr-4 text-xs text-muted-foreground font-medium">Time</th>
                    <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Top Artist</th>
                    <th className="text-left py-2 text-xs text-muted-foreground font-medium">Top Track</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(row => (
                    <tr
                      key={row.id}
                      className="border-b border-border/30 last:border-0 hover:bg-secondary/30 transition-colors"
                    >
                      <td className="py-2.5 pr-4 text-muted-foreground text-xs whitespace-nowrap">
                        {fmtDate(row.date)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-rose-400">
                        {row.tracksPlayed}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-xs text-muted-foreground whitespace-nowrap">
                        {fmtHours(row.listeningMin)}
                      </td>
                      <td className="py-2.5 pr-4 max-w-[140px]">
                        <span className="truncate block text-xs" title={row.topArtist ?? ""}>
                          {row.topArtist ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 max-w-[180px]">
                        <span className="truncate block text-xs text-muted-foreground" title={row.topTrack ?? ""}>
                          {row.topTrack ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// --- Page -------------------------------------------------------------------

export default function LastfmPage() {
  const [data, setData] = useState<LastfmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/lastfm")
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-lg bg-secondary animate-pulse" />
          <div className="h-7 w-32 rounded-lg bg-secondary animate-pulse" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl border bg-card animate-pulse" />
          ))}
        </div>
        <div className="h-52 rounded-xl border bg-card animate-pulse" />
        <div className="h-48 rounded-xl border bg-card animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 px-4 py-3 rounded-xl border border-red-500/20 max-w-md">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Could not load Last.fm data</p>
          <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
          <button onClick={load} className="text-xs text-rose-400 mt-1 hover:underline">
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  if (!data.hasKey) {
    return <ConnectForm onSaved={load} />
  }

  return <Dashboard data={data} onRefresh={load} />
}
