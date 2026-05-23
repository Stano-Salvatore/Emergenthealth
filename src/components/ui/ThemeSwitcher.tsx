"use client"

import { useTheme } from "next-themes"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

const BASE_THEMES = [
  { id: "midnight", label: "Midnight", emoji: "🌑", bg: "#09090f", fg: "#818cf8", desc: "Cool dark" },
  { id: "warm",     label: "Warm",     emoji: "☕", bg: "#120d06", fg: "#f59e0b", desc: "Cozy amber" },
  { id: "forest",   label: "Forest",   emoji: "🌿", bg: "#07100a", fg: "#22c55e", desc: "Deep green" },
  { id: "ocean",    label: "Ocean",    emoji: "🌊", bg: "#060c18", fg: "#38bdf8", desc: "Deep blue" },
  { id: "amoled",   label: "Amoled",   emoji: "⚫", bg: "#000000", fg: "#818cf8", desc: "True black" },
  { id: "light",    label: "Light",    emoji: "☀️", bg: "#f5f5fb", fg: "#6366f1", desc: "Bright" },
]

const ACCENTS = [
  { id: "indigo",  label: "Indigo",  color: "#6366f1" },
  { id: "violet",  label: "Violet",  color: "#8b5cf6" },
  { id: "rose",    label: "Rose",    color: "#f43f5e" },
  { id: "pink",    label: "Pink",    color: "#ec4899" },
  { id: "orange",  label: "Orange",  color: "#f97316" },
  { id: "amber",   label: "Amber",   color: "#f59e0b" },
  { id: "emerald", label: "Emerald", color: "#10b981" },
  { id: "teal",    label: "Teal",    color: "#14b8a6" },
  { id: "sky",     label: "Sky",     color: "#0ea5e9" },
]

export function ThemeSwitcher() {
  const { setTheme } = useTheme()
  const [baseTheme, setBaseTheme] = useState("midnight")
  const [accent, setAccent] = useState("indigo")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setAccent(localStorage.getItem("accent") ?? "indigo")
    setBaseTheme(localStorage.getItem("base_theme") ?? "midnight")
  }, [])

  function applyBaseTheme(id: string) {
    setBaseTheme(id)
    localStorage.setItem("base_theme", id)
    if (id === "light") {
      setTheme("light")
      document.documentElement.removeAttribute("data-theme")
    } else {
      setTheme("dark")
      if (id === "midnight") {
        document.documentElement.removeAttribute("data-theme")
      } else {
        document.documentElement.setAttribute("data-theme", id)
      }
    }
  }

  function applyAccent(id: string) {
    setAccent(id)
    localStorage.setItem("accent", id)
    if (id === "indigo") {
      document.documentElement.removeAttribute("data-accent")
    } else {
      document.documentElement.setAttribute("data-accent", id)
    }
  }

  if (!mounted) return null

  return (
    <div className="space-y-6">
      {/* Base theme */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
          Theme
        </p>
        <div className="grid grid-cols-3 gap-2">
          {BASE_THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => applyBaseTheme(t.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-150 text-center",
                baseTheme === t.id
                  ? "border-primary shadow-md scale-[1.03]"
                  : "border-border hover:border-primary/40 hover:scale-[1.02]"
              )}
              style={{ background: t.bg }}
            >
              <span className="text-lg leading-none">{t.emoji}</span>
              <span className="text-[11px] font-semibold leading-none" style={{ color: t.fg }}>{t.label}</span>
              <span className="text-[9px] leading-none" style={{ color: t.fg, opacity: 0.6 }}>{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Accent color */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
          Accent Color
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          {ACCENTS.map(a => (
            <button
              key={a.id}
              onClick={() => applyAccent(a.id)}
              title={a.label}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition-all duration-150 hover:scale-110",
                accent === a.id ? "border-foreground scale-110 shadow-lg" : "border-transparent opacity-60 hover:opacity-100"
              )}
              style={{ backgroundColor: a.color }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2 capitalize">
          {ACCENTS.find(a => a.id === accent)?.label ?? "Custom"}
        </p>
      </div>
    </div>
  )
}
