"use client"

import { useState, useEffect, useCallback } from "react"
import { Fingerprint, Trash2, Plus } from "lucide-react"
import { startRegistration } from "@simplewebauthn/browser"

interface PasskeyRecord {
  id: string
  name: string
  deviceType: string
  backedUp: boolean
  createdAt: string
  lastUsedAt: string
}

export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState("")

  const load = useCallback(async () => {
    const res = await fetch("/api/passkey/list")
    if (res.ok) setPasskeys(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function registerPasskey() {
    setRegistering(true)
    setError(null)
    try {
      const optRes = await fetch("/api/passkey/register")
      if (!optRes.ok) throw new Error("Failed to get registration options")
      const options = await optRes.json()

      const response = await startRegistration({ optionsJSON: options })

      const verifyRes = await fetch("/api/passkey/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, name: newName || "Passkey" }),
      })

      if (!verifyRes.ok) {
        const { error } = await verifyRes.json()
        throw new Error(error ?? "Registration failed")
      }

      setNewName("")
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("cancelled") && !msg.includes("abort")) {
        setError(msg)
      }
    } finally {
      setRegistering(false)
    }
  }

  async function deletePasskey(id: string) {
    await fetch("/api/passkey/list", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    setPasskeys(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className="rounded-xl border bg-card px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <Fingerprint className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Passkeys (biometric login)</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Sign in with your fingerprint or face — no password needed. Works on Android, iOS, and modern browsers.
      </p>

      {loading ? (
        <div className="text-xs text-muted-foreground py-2">Loading…</div>
      ) : passkeys.length === 0 ? (
        <div className="text-xs text-muted-foreground py-1">No passkeys registered yet.</div>
      ) : (
        <div className="divide-y divide-border/50">
          {passkeys.map(pk => (
            <div key={pk.id} className="flex items-center justify-between py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{pk.name}</p>
                <p className="text-xs text-muted-foreground">
                  {pk.backedUp ? "Synced passkey" : "Device passkey"} · Added {new Date(pk.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => deletePasskey(pk.id)}
                className="text-muted-foreground hover:text-red-400 transition-colors p-1 shrink-0"
                aria-label="Delete passkey"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <input
          type="text"
          placeholder='Name (e.g. "Pixel 9")'
          value={newName}
          onChange={e => setNewName(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={registerPasskey}
          disabled={registering}
          className="flex items-center gap-1.5 rounded-lg bg-primary/15 text-primary px-3 py-2 text-sm font-medium hover:bg-primary/25 transition-colors disabled:opacity-50 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          {registering ? "Registering…" : "Add"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
