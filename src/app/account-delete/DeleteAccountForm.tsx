"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"

export function DeleteAccountForm({ userEmail }: { userEmail: string }) {
  const [confirm, setConfirm] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const canDelete = confirm.trim().toLowerCase() === "delete"

  async function handleDelete() {
    if (!canDelete || deleting) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch("/api/account", { method: "DELETE" })
      if (!res.ok) throw new Error("Deletion failed")
      await signOut({ redirect: false })
      router.push("/?deleted=1")
    } catch {
      setError("Something went wrong. Please try again or contact support.")
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          Signed in as <span className="text-foreground font-medium">{userEmail}</span>.
          Type <span className="font-mono text-red-400 font-medium">delete</span> to confirm.
        </p>
        <input
          type="text"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder='Type "delete" to confirm'
          className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/40"
          autoComplete="off"
        />
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      <button
        onClick={handleDelete}
        disabled={!canDelete || deleting}
        className="w-full rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {deleting ? "Deleting everything…" : "Permanently delete my account"}
      </button>
    </div>
  )
}
