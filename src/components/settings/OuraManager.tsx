"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, LogOut, LogIn } from "lucide-react"

export function OuraManager({ isConnected }: { isConnected: boolean }) {
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  async function handleConnect() {
    setConnecting(true)
    window.location.href = "/api/oura/auth"
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch("/api/oura/disconnect", { method: "POST" })
      if (res.ok) {
        window.location.reload()
      }
    } catch (err) {
      console.error("Failed to disconnect:", err)
      setDisconnecting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Oura Ring Connection</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect your Oura Ring to sync sleep, activity, and health data automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Connection Status</p>
            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  <Badge variant="default" className="bg-green-600">
                    Connected
                  </Badge>
                  <p className="text-xs text-muted-foreground">Your Oura Ring data is being synced</p>
                </>
              ) : (
                <>
                  <Badge variant="secondary">Not Connected</Badge>
                  <p className="text-xs text-muted-foreground">Click below to authorize access</p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {isConnected ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full"
            >
              {disconnecting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Disconnecting…
                </>
              ) : (
                <>
                  <LogOut className="h-3.5 w-3.5 mr-2" />
                  Disconnect Oura Ring
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Connecting…
                </>
              ) : (
                <>
                  <LogIn className="h-3.5 w-3.5 mr-2" />
                  Connect Oura Ring
                </>
              )}
            </Button>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          By connecting, you authorize emergenthealth to access your Oura Ring data including sleep, activity, heart rate, and readiness scores.
        </p>
      </CardContent>
    </Card>
  )
}
