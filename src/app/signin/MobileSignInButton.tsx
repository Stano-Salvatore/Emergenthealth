'use client'

import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"

const GoogleIcon = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
)

const GOOGLE_BTN_CLASS =
  "w-full gap-2.5 h-11 text-sm font-semibold rounded-xl bg-white text-gray-900 hover:bg-gray-100 shadow-lg"

export function MobileSignInButton({ label }: { label: string }) {
  const [bridgeReady, setBridgeReady] = useState<boolean | null>(null)

  useEffect(() => {
    setBridgeReady(!!(window as any).EhAuthBridge?.openSignIn)
  }, [])

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    const key = crypto.randomUUID()
    const nativeBridge = (window as any).EhAuthBridge
    if (nativeBridge?.openSignIn) {
      // Primary path: JSI registered by MainActivity.setupBridgeHooks().
      // Opens Custom Tab at /mobile-signin and loads /mobile-wait in WebView.
      nativeBridge.openSignIn(key)
    } else {
      // Fallback: navigate WebView directly to /mobile-signin. The
      // shouldOverrideUrlLoading handler will intercept the subsequent
      // *.google.com redirect and open a Chrome Custom Tab for OAuth.
      // (ehauth:// was the old fallback but has no intent filter — it fails silently.)
      window.location.href = `/mobile-signin?auth_key=${encodeURIComponent(key)}`
    }
  }

  return (
    <div className="w-full space-y-1.5">
      <Button asChild className={GOOGLE_BTN_CLASS} size="lg">
        <a href="/mobile-signin" onClick={handleClick}>
          <GoogleIcon />
          {label}
        </a>
      </Button>
      {bridgeReady !== null && (
        <p className="text-center text-[11px]" style={{ color: bridgeReady ? '#22c55e' : '#f59e0b' }}>
          {bridgeReady ? '● Native bridge active' : '● Fallback mode — tap to sign in'}
        </p>
      )}
    </div>
  )
}
