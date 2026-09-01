"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { isRouteEnabled } from "@/lib/features"
import { NAV_ITEMS, TAB_ITEMS } from "@/lib/nav-items"

// The palette searches the same manifest the sidebar renders (it used to keep
// its own copy, which drifted until the two disagreed about what the app
// contains — different pages, names and groups, "Claude AI" for Emergy), plus
// the tab-level destinations that deliberately have no sidebar row.

/** Any button can ask for the palette by dispatching this. */
export const OPEN_PALETTE_EVENT = "eh:open-palette"

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
}

const ALL_ITEMS = [...NAV_ITEMS, ...TAB_ITEMS].filter(i => isRouteEnabled(i.href))

function fuzzy(query: string, target: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t.includes(q)) return true
  // character-by-character fuzzy
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const results = ALL_ITEMS.filter(
    (item) => fuzzy(query, item.label) || fuzzy(query, item.section)
  )

  // ⌘K was the only way in, which meant that on a phone this did not exist:
  // there is no keyboard to press it with. The sidebar it competes with is a
  // 40-item list with no filter, so search was the fastest route through the
  // app and also the one route a thumb could not take.
  //
  // A custom event rather than lifted state: the palette is mounted once in
  // the shell, and any button anywhere can now ask for it without threading a
  // prop through everything in between.
  useEffect(() => {
    function openPalette() {
      setOpen(true)
      setQuery("")
      setSelected(0)
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery("")
        setSelected(0)
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_PALETTE_EVENT, openPalette)
    }
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  // Typing resets the highlight to the first result. That happens in the one
  // place the query changes (onQueryChange), not in an effect watching it —
  // an effect would render the old highlight against the new results first.

  function onQueryChange(next: string) {
    setQuery(next)
    setSelected(0)
  }

  function navigate(href: string) {
    router.push(href)
    setOpen(false)
    setQuery("")
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === "Enter" && results[selected]) {
      navigate(results[selected].href)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] px-4"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="hidden sm:block text-[10px] text-muted-foreground bg-secondary rounded px-1.5 py-0.5 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No pages found</p>
          ) : (
            results.map((item, i) => (
              <button
                key={item.href}
                onClick={() => navigate(item.href)}
                onMouseEnter={() => setSelected(i)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  i === selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary/50"
                )}
              >
                <span className="text-base w-5 text-center shrink-0">{item.emoji}</span>
                <span className="text-sm font-medium">{item.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{item.section}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border/50 text-[10px] text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span className="ml-auto"><kbd className="font-mono">⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  )
}
