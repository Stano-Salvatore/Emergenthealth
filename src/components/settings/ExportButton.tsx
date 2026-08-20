"use client"

import { useState } from "react"
import { Check, ChevronDown, Download, Mail, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"

const FREE_EXPORTS = [
  { label: "Health (CSV)", url: "/api/export?type=health" },
  { label: "Mood (CSV)", url: "/api/export?type=mood" },
  { label: "Intake (CSV)", url: "/api/export?type=intake" },
  { label: "Habits (CSV)", url: "/api/export?type=habits" },
]

// Your own data should never be paywalled from you — the full backup is
// free for everyone. Only the formatted transactions CSV (a reporting
// convenience, not a backup) stays a Pro perk.
const BACKUP_EXPORT = { label: "Full Backup (JSON)", url: "/api/export?format=json" }

const PRO_EXPORTS = [
  { label: "Transactions (CSV)", url: "/api/export?type=transactions" },
]

export function ExportButton({ isPro = false }: { isPro?: boolean }) {
  const [open, setOpen] = useState(false)
  const [mailing, setMailing] = useState(false)
  const [mailResult, setMailResult] = useState<string | null>(null)

  // A download link is the right way to hand someone a file, and it works in
  // every browser. It does nothing at all inside an Android WebView that has
  // no DownloadListener, which is where this app mostly runs — so the backup
  // needs a route off the phone that asks nothing of the client.
  async function emailBackup() {
    setMailing(true)
    setMailResult(null)
    try {
      const res = await fetch("/api/export/email", { method: "POST" })
      const d = await res.json().catch(() => null)
      setMailResult(res.ok ? "sent" : (d?.error ?? "Couldn't send the backup."))
    } catch {
      setMailResult("Couldn't send the backup — check your connection.")
    }
    setMailing(false)
  }

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
            <a
              href={BACKUP_EXPORT.url}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary transition-colors"
              download
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              {BACKUP_EXPORT.label}
            </a>
            <button
              onClick={emailBackup}
              disabled={mailing}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary transition-colors disabled:opacity-50 text-left"
            >
              {mailResult === "sent"
                ? <Check className="h-3.5 w-3.5 text-green-400" />
                : <Mail className="h-3.5 w-3.5 text-muted-foreground" />}
              {mailResult === "sent" ? "Sent to your inbox" : mailing ? "Sending…" : "Email me the backup"}
            </button>
            {mailResult && mailResult !== "sent" && (
              <p className="px-3 pb-2 text-[11px] text-amber-400 leading-snug">{mailResult}</p>
            )}
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
                Transactions CSV → Pro
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}
