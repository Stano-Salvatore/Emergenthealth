"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Mail, Loader2, CheckCircle, AlertCircle } from "lucide-react"

type State = "idle" | "sending" | "sent" | "error"

export function DigestButton() {
  const [state, setState] = useState<State>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function send() {
    setState("sending")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/digest/send", { method: "POST" })
      const data = await res.json()
      if (data.ok) {
        setState("sent")
      } else {
        setErrorMsg(data.error ?? "Something went wrong")
        setState("error")
      }
    } catch (e) {
      setErrorMsg(String(e))
      setState("error")
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-primary shrink-0" /> Weekly Digest
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Get a summary of your last 7 days — sleep, steps, HRV, readiness, water &amp; habits — sent to your email.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={send}
            disabled={state === "sending" || state === "sent"}
            className="gap-1.5 shrink-0"
          >
            {state === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {state === "sent" && <CheckCircle className="h-3.5 w-3.5 text-green-400" />}
            {(state === "idle" || state === "error") && <Mail className="h-3.5 w-3.5" />}
            {state === "idle" && "Send digest"}
            {state === "sending" && "Sending…"}
            {state === "sent" && "Sent ✓"}
            {state === "error" && "Retry"}
          </Button>
        </div>

        {state === "error" && errorMsg && (
          <div className="flex items-start gap-1.5 rounded-md bg-red-500/10 px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{errorMsg}</p>
          </div>
        )}

        {state === "sent" && (
          <p className="text-xs text-green-400 bg-green-500/10 rounded-md px-3 py-2">
            Digest sent! Check your inbox in a few seconds.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
