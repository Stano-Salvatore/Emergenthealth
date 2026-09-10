"use client"

import { useEffect, useState } from "react"
import { Download, RefreshCw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { isNativeShell } from "@/lib/native/shell"
import { checkForUpdate, type UpdateCheck } from "@/lib/app-update-client"

/**
 * Which APK this phone runs, and whether CI has published a newer one.
 *
 * Play updates production installs on its own; closed testers and anyone
 * who sideloaded do not get that, and "the app feels broken" is very often
 * "the app is three weeks old". Native only — a browser has no APK.
 */
export function AppUpdateCard() {
  const [inShell, setInShell] = useState(false)
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isNativeShell()) return
    setInShell(true)
    checkForUpdate().then(setCheck).catch(() => {})
  }, [])

  if (!inShell) return null

  async function recheck() {
    setBusy(true)
    try { setCheck(await checkForUpdate(true)) } finally { setBusy(false) }
  }

  const v = check?.verdict
  const installedLabel = v?.installed != null ? `build ${v.installed}` : "a build from before the app reported its number"

  return (
    <Card className={v?.status === "behind" ? "border-amber-500/30 bg-amber-500/5" : ""}>
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">This app build</p>
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={recheck}>
            <RefreshCw className={`h-3 w-3 mr-1 ${busy ? "animate-spin" : ""}`} /> Check now
          </Button>
        </div>

        {!check ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : v?.status === "current" ? (
          <p className="text-sm">Up to date — build {v.installed} is the newest.</p>
        ) : v?.status === "behind" ? (
          <>
            <p className="text-sm">
              Build {v.latest} is out; this phone runs {installedLabel}.
            </p>
            <p className="text-xs text-muted-foreground">
              Installed from Google Play? It updates there. Installed from the download link, install the new one over the top — nothing is lost.
            </p>
            {check.apkUrl && (
              <a
                href={check.apkUrl}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-semibold px-3 py-1.5 hover:bg-amber-500/25 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Download build {v.latest}
              </a>
            )}
          </>
        ) : (
          // Honest about the gap: an unreachable GitHub is not "up to date".
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t find out what the newest build is — this phone runs {installedLabel}. Try again in a minute.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
