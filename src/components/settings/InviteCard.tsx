"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Share2, Copy, Check, Users } from "lucide-react"

interface InviteData {
  code: string
  inviteUrl: string
  referralCount: number
}

export function InviteCard() {
  const [data, setData] = useState<InviteData | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch("/api/invite").then(r => r.json()).then(setData).catch(() => {})
  }, [])

  async function copyLink() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  async function shareLink() {
    if (!data) return
    if (navigator.share) {
      await navigator.share({
        title: "Try Emergenthealth",
        text: "I've been tracking my health with Emergenthealth — it connects sleep, habits, finances, and more. Check it out!",
        url: data.inviteUrl,
      }).catch(() => {})
    } else {
      copyLink()
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invite friends</p>
          {data && data.referralCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-primary">
              <Users className="h-3 w-3" />
              <span>{data.referralCount} joined via your link</span>
            </div>
          )}
        </div>

        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium mb-0.5">Share Emergenthealth</p>
            <p className="text-xs text-muted-foreground">
              Invite friends to track their health. Everyone who joins via your link gets Pro access during their trial.
            </p>
          </div>
        </div>

        {data ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 rounded-lg bg-secondary/50 border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground truncate font-mono">{data.inviteUrl}</p>
            </div>
            <button
              onClick={copyLink}
              title="Copy link"
              className="shrink-0 h-9 w-9 rounded-lg border border-border bg-secondary/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={shareLink}
              title="Share"
              className="shrink-0 h-9 w-9 rounded-lg bg-primary/15 text-primary border border-primary/30 flex items-center justify-center hover:bg-primary/25 transition-colors"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="h-9 rounded-lg bg-secondary/30 animate-pulse" />
        )}
      </CardContent>
    </Card>
  )
}
