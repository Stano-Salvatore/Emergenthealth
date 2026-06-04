"use client"

import { useEffect, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

const DRINKS = [
  { type: "water",  label: "Water",    emoji: "💧", amountMl: 250,  color: "#3b82f6", goal: 2000 },
  { type: "water",  label: "Water",    emoji: "🚰", amountMl: 500,  color: "#3b82f6", goal: 2000 },
  { type: "coffee", label: "Espresso", emoji: "☕", amountMl: 30,   color: "#d97706" },
  { type: "coffee", label: "Coffee",   emoji: "☕", amountMl: 200,  color: "#d97706", goal: 400 },
  { type: "tea",    label: "Tea",      emoji: "🍵", amountMl: 250,  color: "#16a34a" },
  { type: "beer",   label: "Beer",     emoji: "🍺", amountMl: 330,  color: "#ca8a04" },
  { type: "beer",   label: "Beer",     emoji: "🍺", amountMl: 500,  color: "#ca8a04" },
  { type: "wine",   label: "Wine",     emoji: "🍷", amountMl: 150,  color: "#9f1239" },
  { type: "wine",   label: "Wine",     emoji: "🍷", amountMl: 250,  color: "#9f1239" },
]

const TYPE_SUMMARY = [
  { type: "water",  emoji: "💧", label: "Water",  goal: 2000, color: "#3b82f6" },
  { type: "coffee", emoji: "☕", label: "Coffee", goal: 400,  color: "#d97706" },
  { type: "tea",    emoji: "🍵", label: "Tea",    goal: null, color: "#16a34a" },
  { type: "beer",   emoji: "🍺", label: "Beer",   goal: null, color: "#ca8a04" },
  { type: "wine",   emoji: "🍷", label: "Wine",   goal: null, color: "#9f1239" },
]

function fmt(ml: number) {
  return ml >= 1000 ? `${(ml / 1000).toFixed(1)}L` : `${ml}ml`
}

function DrinksWidget({ apiKey }: { apiKey: string }) {
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [logging, setLogging] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/w/intake?key=${encodeURIComponent(apiKey)}`)
    if (res.ok) {
      const d = await res.json()
      setTotals(d.totals ?? {})
    }
  }, [apiKey])

  useEffect(() => { load() }, [load])

  async function log(type: string, amountMl: number, emoji: string) {
    const id = `${type}-${amountMl}`
    setLogging(id)
    await fetch(`/api/w/intake?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amountMl }),
    })
    setTotals(prev => ({ ...prev, [type]: (prev[type] ?? 0) + amountMl }))
    setLogging(null)
    setFlash(emoji)
    setTimeout(() => setFlash(null), 800)
  }

  const activeSummary = TYPE_SUMMARY.filter(t => (totals[t.type] ?? 0) > 0 || ["water", "coffee"].includes(t.type))

  return (
    <div style={{
      minHeight: "100dvh",
      background: "#09090f",
      color: "#f2f2fa",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: "flex",
      flexDirection: "column",
      padding: "16px",
      gap: "14px",
    }}>

      {/* Flash feedback */}
      {flash && (
        <div style={{
          position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.5)", fontSize: "72px", zIndex: 99,
          animation: "fadeout 0.8s forwards",
        }}>
          {flash}
        </div>
      )}

      {/* Today's totals */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {activeSummary.map(s => {
          const total = totals[s.type] ?? 0
          const pct = s.goal ? Math.min(100, (total / s.goal) * 100) : null
          return (
            <div key={s.type} style={{
              flex: "1 1 calc(50% - 4px)",
              minWidth: "120px",
              background: "#100f1a",
              borderRadius: "12px",
              padding: "12px",
            }}>
              <div style={{ fontSize: "10px", color: "#7a7a96", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
                {s.emoji} {s.label}
              </div>
              <div style={{ fontSize: "22px", fontWeight: 700, color: total > 0 ? s.color : "#3f3f5a" }}>
                {total > 0 ? fmt(total) : "—"}
              </div>
              {s.goal && (
                <>
                  <div style={{ fontSize: "10px", color: "#7a7a96", marginTop: "2px" }}>of {fmt(s.goal)}</div>
                  <div style={{ marginTop: "6px", height: "3px", background: "#1e1d2e", borderRadius: "99px" }}>
                    <div style={{ height: "3px", background: s.color, borderRadius: "99px", width: `${pct}%`, transition: "width 0.3s" }} />
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Log buttons */}
      <div>
        <div style={{ fontSize: "10px", color: "#7a7a96", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
          Quick log
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* Group drinks by type */}
          {[
            { type: "water", emoji: "💧", items: DRINKS.filter(d => d.type === "water") },
            { type: "coffee", emoji: "☕", items: DRINKS.filter(d => d.type === "coffee") },
            { type: "tea", emoji: "🍵", items: DRINKS.filter(d => d.type === "tea") },
            { type: "beer", emoji: "🍺", items: DRINKS.filter(d => d.type === "beer") },
            { type: "wine", emoji: "🍷", items: DRINKS.filter(d => d.type === "wine") },
          ].map(group => (
            <div key={group.type} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <div style={{ fontSize: "20px", width: "28px", textAlign: "center", flexShrink: 0 }}>{group.emoji}</div>
              <div style={{ display: "flex", gap: "6px", flex: 1 }}>
                {group.items.map(d => {
                  const id = `${d.type}-${d.amountMl}`
                  const isLogging = logging === id
                  return (
                    <button
                      key={id}
                      onClick={() => log(d.type, d.amountMl, d.emoji)}
                      disabled={!!logging}
                      style={{
                        flex: 1,
                        padding: "10px 6px",
                        borderRadius: "10px",
                        border: `1px solid ${d.color}33`,
                        background: isLogging ? `${d.color}22` : "#100f1a",
                        color: d.color,
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s",
                        opacity: logging && !isLogging ? 0.5 : 1,
                      }}
                    >
                      {isLogging ? "✓" : `+${d.amountMl}ml`}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "auto", textAlign: "right", fontSize: "10px", color: "#3f3f5a" }}>
        {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>

      <style>{`
        @keyframes fadeout {
          0% { opacity: 1; transform: scale(1.2); }
          100% { opacity: 0; transform: scale(0.9); }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        button:active { transform: scale(0.95); }
      `}</style>
    </div>
  )
}

function DrinksWidgetPageInner() {
  const searchParams = useSearchParams()
  const apiKey = searchParams.get("key") ?? ""

  if (!apiKey) {
    return (
      <div style={{ minHeight: "100dvh", background: "#09090f", color: "#7a7a96", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", fontSize: "14px", padding: "24px", textAlign: "center" }}>
        Missing API key. Add <code style={{ color: "#6366f1" }}>?key=YOUR_KEY</code> to the URL.
      </div>
    )
  }

  return <DrinksWidget apiKey={apiKey} />
}

export default function DrinksWidgetPage() {
  return (
    <Suspense>
      <DrinksWidgetPageInner />
    </Suspense>
  )
}
