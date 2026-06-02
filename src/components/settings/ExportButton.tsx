"use client"

import { useState } from "react"
import { Download, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"

const EXPORTS = [
  { label: "Health (CSV)", url: "/api/export?type=health" },
  { label: "Mood (CSV)", url: "/api/export?type=mood" },
  { label: "Intake (CSV)", url: "/api/export?type=intake" },
  { label: "Habits (CSV)", url: "/api/export?type=habits" },
  { label: "Transactions (CSV)", url: "/api/export?type=transactions" },
  { label: "All data (JSON)", url: "/api/export?format=json" },
]

export function ExportButton() {
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
          <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg overflow-hidden">
            {EXPORTS.map(e => (
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
          </div>
        </>
      )}
    </div>
  )
}
