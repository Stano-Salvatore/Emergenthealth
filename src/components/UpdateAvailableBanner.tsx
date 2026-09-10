"use client"

/**
 * One quiet line when the APK on this phone is behind the one CI published.
 *
 * Play handles updates for production installs; closed testers and sideloads
 * get nothing, and a phone ran build 1008 for days while 1051 waited. Native
 * only, and dismissing it silences that build number — the next one is new
 * news. Nothing to say when the server can't say what's newest: a banner
 * guessing is worse than no banner.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { Download, X } from "lucide-react"
import { checkForUpdate, type UpdateCheck } from "@/lib/app-update-client"

const DISMISSED_KEY = "update_banner_dismissed_build"

export function UpdateAvailableBanner() {
  const [check, setCheck] = useState<UpdateCheck | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const c = await checkForUpdate().catch(() => null)
      if (cancelled || !c || c.verdict.status !== "behind") return
      try {
        if (localStorage.getItem(DISMISSED_KEY) === String(c.verdict.latest)) return
      } catch { /* private mode: show it */ }
      setCheck(c)
    }
    run()
    return () => { cancelled = true }
  }, [])

  if (!check || check.verdict.status !== "behind") return null
  const { latest, installed } = check.verdict

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, String(latest)) } catch { /* ignore */ }
    setCheck(null)
  }

  return (
    <div className="fixed top-2 left-2 right-2 z-40 lg:left-auto lg:w-96">
      <div className="rounded-xl border border-primary/30 bg-primary/10 backdrop-blur-md px-3 py-2.5 shadow-lg flex items-start gap-2.5">
        <Download className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-primary">App update available</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Build {latest} is out; this phone runs {installed != null ? `build ${installed}` : "an older one"}.
          </p>
          <span className="inline-flex gap-3 mt-1">
            {check.apkUrl && (
              <a href={check.apkUrl} onClick={dismiss} className="text-[11px] font-medium text-primary underline underline-offset-2">
                Download
              </a>
            )}
            <Link href="/dashboard/settings" onClick={dismiss} className="text-[11px] font-medium text-primary underline underline-offset-2">
              Details in Settings
            </Link>
          </span>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
