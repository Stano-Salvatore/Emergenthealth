"use client"

import Link from "next/link"
import { Zap } from "lucide-react"

interface ProGateProps {
  feature?: string
  children: React.ReactNode
  isPro: boolean
  /** Show a blur overlay instead of hiding the content */
  blur?: boolean
}

export function ProGate({ feature, children, isPro, blur = false }: ProGateProps) {
  if (isPro) return <>{children}</>

  if (blur) {
    return (
      <div className="relative">
        <div className="pointer-events-none select-none blur-sm opacity-50">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center">
          <Link
            href="/pricing"
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-primary/90 transition-all active:scale-95"
          >
            <Zap className="h-4 w-4" />
            Upgrade to Pro
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
      <div className="shrink-0 mt-0.5 h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
        <Zap className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">Pro feature</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {feature ?? "This feature"} is available on the Pro plan.
        </p>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          Upgrade — from €6.99/mo →
        </Link>
      </div>
    </div>
  )
}

/** Inline badge that links to pricing */
export function ProBadge({ className }: { className?: string }) {
  return (
    <Link
      href="/pricing"
      className={`inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/25 transition-colors ${className ?? ""}`}
    >
      <Zap className="h-2.5 w-2.5" />
      PRO
    </Link>
  )
}
