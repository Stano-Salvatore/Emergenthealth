"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Copy, Check, RefreshCw, Trash2, Smartphone } from "lucide-react"
import { activateWidget } from "@/lib/widget-activator"

function maskKey(key: string): string {
  if (key.length <= 8) return key
  return key.slice(0, 8) + "****..." + "****" + key.slice(-4)
}

export function WidgetSetupCapacitor() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [activated, setActivated] = useState(false)
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    fetch("/api/widget/key")
      .then((r) => r.json())
      .then((data) => {
        setApiKey(data.key ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function generateKey() {
    setGenerating(true)
    try {
      const res = await fetch("/api/widget/key", { method: "POST" })
      const data = await res.json()
      if (data.key) {
        setApiKey(data.key)
        setShowSetup(true)
      }
    } catch {
      // silently ignore
    }
    setGenerating(false)
  }

  async function revokeKey() {
    if (!confirm("Revoke the widget API key? The widget will stop working until you generate a new key.")) return
    setRevoking(true)
    try {
      await fetch("/api/widget/key", { method: "DELETE" })
      setApiKey(null)
      setShowSetup(false)
    } catch {
      // silently ignore
    }
    setRevoking(false)
  }

  async function handleActivate() {
    if (!apiKey) return
    setActivating(true)
    try {
      await activateWidget(apiKey, window.location.origin)
      setActivated(true)
      setTimeout(() => setActivated(false), 3000)
    } catch {
      // silently ignore
    }
    setActivating(false)
  }

  async function copyKey() {
    if (!apiKey) return
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // silently ignore
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-base">📱</span>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Android Widget</p>
        </div>

        <div>
          <p className="text-sm font-medium">Android Home Screen Widget</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Log water, coffee and drinks directly from your home screen
          </p>
        </div>

        {/* API key section */}
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            {apiKey ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Widget API Key</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-secondary/60 px-3 py-2 font-mono text-xs text-muted-foreground break-all">
                    {maskKey(apiKey)}
                  </code>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleActivate} disabled={activating}>
                    {activated ? (
                      <>
                        <Check className="h-3 w-3" /> Activated!
                      </>
                    ) : (
                      <>
                        <Smartphone className="h-3 w-3" /> {activating ? "Activating…" : "Activate Widget"}
                      </>
                    )}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={copyKey}>
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-green-400" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy Key
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={generateKey}
                    disabled={generating}
                  >
                    <RefreshCw className={`h-3 w-3 ${generating ? "animate-spin" : ""}`} />
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={revokeKey}
                    disabled={revoking}
                  >
                    <Trash2 className="h-3 w-3" />
                    Revoke
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  No widget key yet. Generate one to enable the Android home screen widget.
                </p>
                <Button size="sm" onClick={generateKey} disabled={generating} className="gap-1.5">
                  {generating ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" /> Generating…
                    </>
                  ) : (
                    "Generate Key"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Setup instructions — shown after generating or manually toggled */}
        {apiKey && (
          <div className="border-t border-border/50 pt-3 space-y-3">
            <button
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setShowSetup((v) => !v)}
            >
              {showSetup ? "Hide setup instructions ▲" : "Setup Widget in App ▼"}
            </button>

            {showSetup && (
              <div className="space-y-3">
                <p className="text-xs font-medium">Setup Widget in App</p>
                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>Open the app on your Android phone</li>
                  <li>Go to Settings → Android Widget</li>
                  <li>Tap <strong>Activate Widget</strong> — key is stored automatically</li>
                  <li>Long-press home screen → Widgets → Emergenthealth Quick Log</li>
                </ol>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Manual entry — full key:</p>
                  <div className="rounded-lg bg-secondary/60 border border-border/50 px-3 py-2 font-mono text-[11px] text-muted-foreground break-all">
                    {apiKey}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
