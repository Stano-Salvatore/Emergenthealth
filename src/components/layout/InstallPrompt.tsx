"use client"

import { useEffect, useState } from "react"
import { X, Download } from "lucide-react"

const DISMISS_KEY = "install_prompt_dismissed_v1"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIos, setIsIos] = useState(false)

  useEffect(() => {
    // Don't show if already installed (standalone mode)
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true
    if (standalone) return

    // Don't show if recently dismissed
    try {
      const until = sessionStorage.getItem(DISMISS_KEY)
      if (until && Date.now() < parseInt(until)) return
    } catch { /* */ }

    const ua = navigator.userAgent
    const ios = /ipad|iphone|ipod/i.test(ua) && !(window as any).MSStream
    setIsIos(ios)

    // Listen for the Chrome/Android install prompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setShow(true)
    }
    window.addEventListener("beforeinstallprompt", handler)

    // On iOS there's no native prompt — show manual instructions after a few seconds
    if (ios) {
      const t = setTimeout(() => setShow(true), 4000)
      return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", handler) }
    }

    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000)) } catch { /* */ }
    setShow(false)
  }

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === "accepted") setShow(false)
    setDeferredPrompt(null)
  }

  if (!show) return null

  return (
    <div className="fixed bottom-36 lg:bottom-4 left-4 right-4 lg:left-auto lg:right-6 lg:w-80 z-50">
      <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="Emergenthealth" className="h-10 w-10 rounded-xl shrink-0" />
            <div>
              <p className="text-sm font-semibold leading-tight">Install Emergenthealth</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isIos ? "Tap Share → Add to Home Screen" : "Add to your home screen for the best experience"}
              </p>
            </div>
          </div>
          <button onClick={dismiss} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-0.5 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!isIos && deferredPrompt && (
          <button
            onClick={install}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors active:scale-95"
          >
            <Download className="h-4 w-4" />
            Install app
          </button>
        )}

        {isIos && (
          <div className="mt-3 rounded-xl bg-secondary/60 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
            In Safari: tap the <strong className="text-foreground">Share</strong> button (↑) at the bottom, then
            tap <strong className="text-foreground">Add to Home Screen</strong>.
          </div>
        )}
      </div>
    </div>
  )
}
