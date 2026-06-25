"use client"

import { useState } from "react"
import { Download, ChevronDown, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"

const FREE_EXPORTS = [
  { label: "Health (CSV)", url: "/api/export?type=health" },
  { label: "Mood (CSV)", url: "/api/export?type=mood" },
  { label: "Intake (CSV)", url: "/api/export?type=intake" },
  { label: "Habits (CSV)", url: "/api/export?type=habits" },
]

const PRO_EXPORTS = [
  { label: "Transactions (CSV)", url: "/api/export?type=transactions" },
  { label: "All data (JSON)", url: "/api/export?format=json" },
]

export function ExportButton({ isPro = false }: { isPro?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(o => !o)}
        className="gap-1.5"
      >
        <Download className="h-3.5 w-3.5" />
        Export
        <ChevronDown className="h-3 w-3" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg overflow-hidden">
            {FREE_EXPORTS.map(e => (
              <a
                key={e.url}
                href={e.url}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary transition-colors"
                download
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                {e.label}
              </a>
            ))}
            <div className="border-t border-border/50" />
            {isPro ? (
              PRO_EXPORTS.map(e => (
                <a
                  key={e.url}
                  href={e.url}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary transition-colors"
                  download
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  {e.label}
                </a>
              ))
            ) : (
              <Link
                href="/pricing"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-sm text-primary/70 hover:bg-secondary transition-colors"
              >
                <Zap className="h-3.5 w-3.5 text-primary" />
                Transactions & JSON → Pro
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}
