"use client"

import { useState } from "react"
import { MessageSquarePlus, X } from "lucide-react"
import { FeedbackForm } from "./FeedbackForm"

// Desktop only (hidden below lg): on a phone the same form lives in
// Settings → Help & Support, where a floating button would sit on the nav.
export function FeedbackButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed left-4 lg:left-auto lg:right-6 z-50 hidden lg:flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-white shadow-lg shadow-primary/25 hover:bg-primary/90 transition-all active:scale-95 bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-6"
        aria-label="Send feedback"
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">Suggest</span>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-36 left-4 lg:left-auto lg:bottom-20 lg:right-6 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border bg-card shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
            <p className="text-sm font-semibold">Share your thoughts</p>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-4">
            <FeedbackForm autoFocus onSent={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
