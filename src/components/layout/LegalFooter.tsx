"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

/**
 * The corner Privacy / Terms links.
 *
 * Deliberately absent inside the dashboard. This is `fixed bottom-0 right-0`
 * at `z-50`, and `BottomNav` is `fixed bottom-0 inset-x-0` at `z-40` below
 * `lg` — so on every phone and tablet these two words sat directly on top of
 * the "Habits" and "Settings" labels. Raising the nav above them would only
 * swap which one is unreadable, and pushing them up the screen puts them over
 * page content instead. On the dashboard the links live in Settings, next to
 * the version line, which is where someone goes looking for them anyway.
 */
export function LegalFooter() {
  const pathname = usePathname()
  if (pathname?.startsWith("/dashboard")) return null

  return (
    <footer className="fixed bottom-0 right-0 z-50 p-3 flex gap-3 pointer-events-none">
      <Link href="/privacy" className="pointer-events-auto text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Privacy</Link>
      <Link href="/terms" className="pointer-events-auto text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Terms</Link>
    </footer>
  )
}
