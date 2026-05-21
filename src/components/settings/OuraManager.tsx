"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, LogOut, LogIn, Key } from "lucide-react"

export function OuraManager({ isConnected }: { isConnected: boolean }) {
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [pat, setPat] = useState("")
  const [patStatus, setPatStatus] = useState<"idle" | "loading" | "error">("idle")
  const [patError, setPatError] = useState("")

  async function handleConnect() {
    setConnecting(true)
    window.location.href = "/api/oura/auth"
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch("/api/oura/disconnect", { method: "POST" })
      if (res.ok) window.location.reload()
    } catch {
      setDisconnecting(false)
    }
  }

  async function handlePat() {
    if (!pat.trim()) return
    setPatStatus("loading")
    setPatError("")
    try {
      const res = await fetch("/api/oura/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPatStatus("error")
        setPatError(data.error ?? "Failed to save token")
      } else {
        window.location.reload()
      }
    } catch {
      setPatStatus("error")
      setPatError("Network error")
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Oura Ring Connection</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect your Oura Ring to sync sleep, activity, and health data.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge variant="default" className="bg-green-600">Connected</Badge>
          ) : (
            <Badge variant="secondary">Not Connected</Badge>
          )}
          <p className="text-xs text-muted-foreground">
            {isConnected ? "Your Oura Ring data is ready to sync" : "Connect to start syncing"}
          </p>
        </div>

        {isConnected ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="w-full"
          >
            {disconnecting ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Disconnecting…</>
            ) : (
              <><LogOut className="h-3.5 w-3.5 mr-2" />Disconnect Oura Ring</>
            )}
          </Button>
        ) : (
          <div className="space-y-3">
            {/* OAuth option */}
            <Button onClick={handleConnect} disabled={connecting} className="w-full" size="sm">
              {connecting ? (
                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Connecting…</>
              ) : (
                <><LogIn className="h-3.5 w-3.5 mr-2" />Connect via OAuth</>
              )}
            </Button>

            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Personal Access Token option */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Key className="h-3 w-3" />
                Personal Access Token
                <span className="text-muted-foreground/60">— get yours at cloud.ouraring.com/personal-access-tokens</span>
              </p>
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="Paste your PAT here"
                  value={pat}
                  onChange={e => setPat(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handlePat()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePat}
                  disabled={patStatus === "loading" || !pat.trim()}
                  className="shrink-0 h-8"
                >
                  {patStatus === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </Button>
              </div>
              {patError && <p className="text-xs text-red-400">{patError}</p>}
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          By connecting, you authorize emergenthealth to access your Oura Ring data including sleep, activity, heart rate, and readiness scores.
        </p>
      </CardContent>
    </Card>
  )
}
