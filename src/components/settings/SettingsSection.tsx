"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

// Collapsible group heading for the settings page, so the ~25 setting cards
// aren't one endless flat scroll on a phone. Server-rendered cards are passed
// through as children; only the open/closed toggle is client-side.
export function SettingsSection({
  title,
  emoji,
  defaultOpen = true,
  children,
}: {
  title: string
  emoji: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="space-y-4">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center justify-between w-full pt-1 group"
      >
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2 group-hover:text-foreground transition-colors">
          <span className="text-sm">{emoji}</span> {title}
        </h2>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground/50 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </section>
  )
}
