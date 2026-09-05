"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

/**
 * Run every server-side sync now, then reload the card.
 *
 * This used to live on a second card that repeated the rows above it. What it
 * alone offered was the button — and a refresh icon over sync rows promises a
 * sync, not a re-read, so it runs them and then shows what they did.
 *
 * allSettled rather than all: one source failing must not stop the others, and
 * a source that isn't connected answers with a quick 4xx nobody needs to see
 * here — its row already says "not connected".
 */
export function SyncNowButton({ sources }: { sources: string[] }) {
  const [syncing, setSyncing] = useState(false)
  const router = useRouter()

  return (
    <Button
      size="sm" variant="ghost" className="shrink-0 h-7 w-7 p-0"
      aria-label="Sync now" title="Sync now"
      disabled={syncing}
      onClick={async () => {
        setSyncing(true)
        try {
          await Promise.allSettled(sources.map(id => fetch(`/api/sync/${id}`, { method: "POST" })))
        } finally {
          setSyncing(false)
          // Refresh regardless: a sync that failed still recorded that it
          // failed, which is exactly what someone pressing this wants to see.
          router.refresh()
        }
      }}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
    </Button>
  )
}
