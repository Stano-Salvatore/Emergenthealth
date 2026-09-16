"use client"

import { useTheme } from "next-themes"
import { readLocalString, useClientValue, useLocalSetting } from "@/lib/use-client-value"
import { LIGHT_THEMES } from "@/lib/theme-mode"
import { cn } from "@/lib/utils"

// Light themes get next-themes "light" with the palette riding on data-theme;
// the shared LIGHT_THEMES set is the authority (the status bar reads it too).
const BASE_THEMES = [
  { id: "midnight", label: "Midnight", emoji: "🌑", bg: "#09090f", fg: "#818cf8", desc: "Cool dark" },
  { id: "warm",     label: "Warm",     emoji: "☕", bg: "#120d06", fg: "#f59e0b", desc: "Cozy amber" },
  { id: "forest",   label: "Forest",   emoji: "🌿", bg: "#07100a", fg: "#22c55e", desc: "Deep green" },
  { id: "ocean",    label: "Ocean",    emoji: "🌊", bg: "#060c18", fg: "#38bdf8", desc: "Deep blue" },
  { id: "amoled",   label: "Amoled",   emoji: "⚫", bg: "#000000", fg: "#818cf8", desc: "True black" },
  { id: "light",    label: "Light",    emoji: "☀️", bg: "#f5f5fb", fg: "#6366f1", desc: "Bright" },
  { id: "sunny",    label: "Sunny",    emoji: "🌤", bg: "#fdf6ec", fg: "#e0764f", desc: "Warm cream" },
  { id: "blossom",  label: "Blossom",  emoji: "🌸", bg: "#fdf0f4", fg: "#d16a8a", desc: "Soft pink" },
  { id: "sage",     label: "Sage",     emoji: "🍃", bg: "#f2f5ee", fg: "#5f7d4f", desc: "Calm green" },
  { id: "paper",    label: "Paper",    emoji: "📰", bg: "#f7f5f1", fg: "#26221c", desc: "Minimal" },
  { id: "lilac",    label: "Lilac",    emoji: "🫧", bg: "#eceafb", fg: "#6d5bc7", desc: "Pastel purple" },
  { id: "sand",     label: "Sand",     emoji: "🏜", bg: "#f4ecdf", fg: "#a0722e", desc: "Desert warm" },
  { id: "mint",     label: "Mint",     emoji: "🍀", bg: "#eafaf3", fg: "#10b981", desc: "Fresh" },
  { id: "dusk",     label: "Dusk",     emoji: "🌆", bg: "#171221", fg: "#b79ce8", desc: "Dark plum" },
  { id: "ember",    label: "Ember",    emoji: "🔥", bg: "#14100e", fg: "#f08c4a", desc: "Charcoal" },
  { id: "navy",     label: "Navy",     emoji: "🌌", bg: "#0c1020", fg: "#8b9ce8", desc: "Deep navy" },
  { id: "phosphor", label: "Phosphor", emoji: "🫀", bg: "#050805", fg: "#34d399", desc: "Telemetry" },
  { id: "nord",     label: "Nord",     emoji: "❄️", bg: "#242933", fg: "#88c0d0", desc: "Arctic" },
]

// Shape and type only — combines freely with any theme and accent. "Original"
// removes the attribute, which is the app exactly as it has always looked.
const UI_STYLES = [
  { id: "original", label: "Original", emoji: "📱", desc: "Current look" },
  { id: "sunny",    label: "Sunny",    emoji: "🌤", desc: "Soft & friendly" },
  { id: "glass",    label: "Glass",    emoji: "🌌", desc: "Frosted hairlines" },
  { id: "clay",     label: "Clay",     emoji: "🫧", desc: "Squishy 3D" },
  { id: "pillow",   label: "Pillow",   emoji: "☁️", desc: "Extra round" },
  { id: "sharp",    label: "Sharp",    emoji: "✂️", desc: "Square & precise" },
  { id: "vitals",   label: "Vitals",   emoji: "🫀", desc: "Mono telemetry" },
  { id: "retro",    label: "Retro",    emoji: "📼", desc: "Hard offsets" },
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
  { id: "coral",   label: "Coral",   color: "#e0764f" },
  { id: "lime",    label: "Lime",    color: "#84cc16" },
  { id: "slate",   label: "Slate",   color: "#64748b" },
]

export function ThemeSwitcher() {
  const { setTheme } = useTheme()
  // The saved theme is in localStorage, which the server cannot read — so the
  // server renders nothing at all (mounted === false) and the client has the
  // real answer from its first paint, rather than flashing the defaults.
  const mounted = useClientValue(() => true, false)
  const [baseTheme, setBaseTheme] = useLocalSetting(() => readLocalString("base_theme", "midnight"), "midnight")
  const [accent, setAccent] = useLocalSetting(() => readLocalString("accent", "indigo"), "indigo")
  const [uiStyle, setUiStyle] = useLocalSetting(() => readLocalString("ui_style", "original"), "original")

  function applyBaseTheme(id: string) {
    setBaseTheme(id)
    localStorage.setItem("base_theme", id)
    setTheme(LIGHT_THEMES.has(id) ? "light" : "dark")
    // Midnight and Light are the attribute-less defaults of their modes.
    if (id === "midnight" || id === "light") document.documentElement.removeAttribute("data-theme")
    else document.documentElement.setAttribute("data-theme", id)
  }

  function applyUiStyle(id: string) {
    setUiStyle(id)
    localStorage.setItem("ui_style", id)
    if (id === "original") document.documentElement.removeAttribute("data-ui")
    else document.documentElement.setAttribute("data-ui", id)
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

      {/* UI style — shape & type, orthogonal to the palette above */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
          UI Style
        </p>
        <div className="grid grid-cols-4 gap-2">
          {UI_STYLES.map(u => (
            <button
              key={u.id}
              onClick={() => applyUiStyle(u.id)}
              title={u.desc}
              className={cn(
                "flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 bg-secondary/40 transition-all duration-150 text-center",
                uiStyle === u.id
                  ? "border-primary shadow-md scale-[1.03]"
                  : "border-border hover:border-primary/40 hover:scale-[1.02]"
              )}
            >
              <span className="text-base leading-none">{u.emoji}</span>
              <span className="text-[10px] font-semibold leading-none">{u.label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {UI_STYLES.find(u => u.id === uiStyle)?.desc ?? ""}
        </p>
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
