"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { isFeatureEnabled } from "@/lib/features"

const TABS = [
  { key: "metrics", label: "Metrics", emoji: "❤️" },
  { key: "weight",  label: "Weight",  emoji: "⚖️" },
  { key: "body",    label: "Body",    emoji: "📏" },
  { key: "correlations", label: "Correlations", emoji: "✨" },
  { key: "labs",    label: "Lab Results", emoji: "🩸" },
].filter(t => t.key !== "labs" || isFeatureEnabled("labs"))

export function HealthTabBar({ activeTab }: { activeTab: string }) {
  return (
    <div className="flex gap-0.5 border-b border-border overflow-x-auto scrollbar-none">
      {TABS.map(t => (
        <Link
          key={t.key}
          href={`/dashboard/health${t.key === "metrics" ? "" : `?tab=${t.key}`}`}
          className={cn(
            "px-3 py-2 text-sm transition-colors rounded-t-md whitespace-nowrap",
            activeTab === t.key
              ? "text-foreground border-b-2 border-primary font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="mr-1">{t.emoji}</span>{t.label}
        </Link>
      ))}
    </div>
  )
}
