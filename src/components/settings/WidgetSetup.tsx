"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Check, Copy, ExternalLink, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"

export function WidgetSetup({ appUrl, apiKey }: { appUrl: string; apiKey?: string }) {
  const [copied, setCopied] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  async function copyScript() {
    try {
      const res = await fetch("/widget.js")
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const drinksUrl = apiKey
    ? `${appUrl}/w/drinks?key=${apiKey}`
    : `${appUrl}/w/drinks?key=YOUR_API_KEY`

  async function copyDrinksUrl() {
    try {
      await navigator.clipboard.writeText(drinksUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch {}
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-5">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Home Screen &amp; Lock Screen Widgets</p>
        </div>

        {/* Android section */}
        <div>
          <p className="text-sm font-medium mb-2">🤖 Android widgets</p>
          <div className="rounded-xl bg-secondary/40 border border-border/60 divide-y divide-border/40">
            <div className="px-4 py-3">
              <p className="text-sm font-medium mb-1">Interactive drinks widget</p>
              <p className="text-xs text-muted-foreground mb-2">
                Tap to log water, coffee, beer — directly from your home screen.
                Use <strong>WebsiteWidget</strong> (Android) or the <strong>Median app</strong>.
              </p>
              <div className="rounded-lg bg-secondary/60 px-3 py-2 font-mono text-xs text-muted-foreground break-all mb-2">
                {drinksUrl}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={copyDrinksUrl}>
                  {copiedUrl ? <><Check className="h-3 w-3 text-green-400" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy URL</>}
                </Button>
              </div>
              {!apiKey && (
                <p className="text-xs text-amber-400 mt-2">
                  Generate an API key below to get your personal widget URL.
                </p>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="text-sm font-medium mb-1">How to set up</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Install <strong>WebsiteWidget</strong> from Play Store (free)</li>
                <li>Long-press home screen → Widgets → WebsiteWidget</li>
                <li>Paste the URL above into the widget settings</li>
                <li>Save — your drinks widget is live!</li>
              </ol>
            </div>
          </div>
        </div>

        {/* iOS section */}
        <div>
          <p className="text-sm font-medium mb-2">🍎 iOS widgets (Scriptable)</p>
          <div className="rounded-xl bg-secondary/40 border border-border/60 divide-y divide-border/40">
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-primary font-bold text-sm shrink-0 mt-0.5">1</span>
              <p className="text-sm">Install <strong>Scriptable</strong> from the App Store</p>
            </div>
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-primary font-bold text-sm shrink-0 mt-0.5">2</span>
              <div className="space-y-2 flex-1 min-w-0">
                <p className="text-sm">Open Scriptable → tap <strong>+</strong> → paste the widget script</p>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={copyScript}>
                    {copied ? <><Check className="h-3 w-3 text-green-400" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy script</>}
                  </Button>
                  <a href="/widget.js" download="emergenthealth-widget.js">
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
                      <ExternalLink className="h-3 w-3" /> Download
                    </Button>
                  </a>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-primary font-bold text-sm shrink-0 mt-0.5">3</span>
              <div className="space-y-1 flex-1 min-w-0">
                <p className="text-sm">Set <code className="text-xs bg-secondary px-1 py-0.5 rounded">BASE_URL</code> and <code className="text-xs bg-secondary px-1 py-0.5 rounded">API_KEY</code> at the top of the script</p>
                <div className="rounded-lg bg-secondary/60 px-3 py-2 font-mono text-xs text-muted-foreground break-all">
                  BASE_URL = &quot;{appUrl}&quot;
                </div>
                <p className="text-xs text-muted-foreground">API key: scroll to <strong>API Keys</strong> below and copy any key</p>
              </div>
            </div>
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-primary font-bold text-sm shrink-0 mt-0.5">4</span>
              <div className="text-sm space-y-1">
                <p><strong>Home screen:</strong> long-press → + → Scriptable → pick size</p>
                <p><strong>Lock screen:</strong> edit lock screen → + → Scriptable → accessory</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
