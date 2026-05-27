"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function DeleteAccount() {
  const [showModal, setShowModal] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (confirmText !== "DELETE") return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account", { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Something went wrong. Please try again.")
        setLoading(false)
        return
      }
      await signOut({ callbackUrl: "/" })
    } catch {
      setError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  return (
    <>
      <Card className="border-destructive/20 bg-destructive/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Delete Account</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently deletes all your data. This cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmText("")
                setError(null)
                setShowModal(true)
              }}
            >
              Delete my account
            </Button>
          </div>
        </CardContent>
      </Card>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <div>
              <p className="text-base font-semibold">Are you sure?</p>
              <p className="text-sm text-muted-foreground mt-1">
                Type <span className="font-mono font-bold text-foreground">DELETE</span> to confirm. This will permanently remove all your data.
              </p>
            </div>

            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              disabled={loading}
              autoFocus
            />

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowModal(false)
                  setConfirmText("")
                  setError(null)
                }}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={confirmText !== "DELETE" || loading}
              >
                {loading ? "Deleting…" : "Yes, delete everything"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
