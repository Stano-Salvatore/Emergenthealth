"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

export function ExistSyncButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle")
  const [msg, setMsg] = useState("")

  async function handleSync() {
    setStatus("loading")
    setMsg("")
    try {
      const res = await fetch("/api/sync/exist", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setStatus("error")
        setMsg(data.error ?? "Sync failed")
      } else {
        setStatus("ok")
        setMsg(`Synced ${data.synced} days`)
        setTimeout(() => window.location.reload(), 1000)
      }
    } catch {
      setStatus("error")
      setMsg("Network error")
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={status === "loading"}
        className="gap-1.5"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
        Sync Exist.io
      </Button>
      {msg && (
        <span className={`text-xs ${status === "error" ? "text-red-400" : "text-green-400"}`}>
          {msg}
        </span>
      )}
    </div>
  )
}
