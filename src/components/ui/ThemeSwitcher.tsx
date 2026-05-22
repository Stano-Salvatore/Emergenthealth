"use client"

import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

const ACCENTS = [
  { id: "indigo", label: "Indigo", color: "#6366f1" },
  { id: "emerald", label: "Emerald", color: "#10b981" },
  { id: "rose", label: "Rose", color: "#f43f5e" },
  { id: "amber", label: "Amber", color: "#f59e0b" },
  { id: "sky", label: "Sky", color: "#0ea5e9" },
]

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [accent, setAccent] = useState("indigo")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setAccent(localStorage.getItem("accent") ?? "indigo")
  }, [])

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
    <div className="space-y-5">
      {/* Mode */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
          Appearance
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setTheme("dark")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition-colors",
              theme === "dark"
                ? "border-primary/50 bg-primary/10 text-primary font-medium"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
          >
            <Moon className="h-4 w-4" />
            Dark
          </button>
          <button
            onClick={() => setTheme("light")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition-colors",
              theme === "light"
                ? "border-primary/50 bg-primary/10 text-primary font-medium"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
          >
            <Sun className="h-4 w-4" />
            Light
          </button>
        </div>
      </div>

      {/* Accent */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
          Accent Color
        </p>
        <div className="flex items-center gap-3">
          {ACCENTS.map(a => (
            <button
              key={a.id}
              onClick={() => applyAccent(a.id)}
              title={a.label}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition-all duration-150 hover:scale-110",
                accent === a.id ? "border-foreground scale-110 shadow-md" : "border-transparent opacity-70 hover:opacity-100"
              )}
              style={{ backgroundColor: a.color }}
            />
          ))}
          <span className="text-xs text-muted-foreground ml-1 capitalize">
            {ACCENTS.find(a => a.id === accent)?.label}
          </span>
        </div>
      </div>
    </div>
  )
}
