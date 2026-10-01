// The pieces an insight card is drawn with — the change pill, the trust badge
// and the two group columns. Shared by the Insights page and the onboarding's
// example, so the example a new user is shown is drawn by the same code as the
// cards they will get, and cannot drift into a picture of a card that no
// longer exists.

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type Tier = "strong" | "suggestive" | "noise"

/** What each trust tier is called on screen. */
export const TIER_LABEL: Record<Tier, string> = {
  strong: "Solid",
  suggestive: "Suggestive",
  noise: "Could be chance",
}

export function DeltaPill({ delta }: { delta: number }) {
  const positive = delta >= 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        positive
          ? "bg-green-500/15 text-green-400"
          : "bg-red-500/15 text-red-400",
      )}
    >
      {positive ? "+" : ""}{delta.toFixed(1)}%
    </span>
  )
}

/** Trust tier: permutation test + false-discovery control, not just sample size. */
export function TierBadge({ tier, confident }: { tier?: Tier; confident?: boolean }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[10px] font-semibold px-1.5",
        tier === "strong" ? "text-emerald-400"
          : tier === "suggestive" ? "text-amber-400"
          : tier === "noise" ? "text-muted-foreground"
          : confident ? "text-primary" : "text-muted-foreground",
      )}
    >
      {/* The fallback used to read "Strong" for a card with no tier —
          which means only that both sides had ten days, and in plain
          English outranks "Solid", which means it survived correction
          across the whole run. The weaker badge read stronger. A card
          with no tier has not been placed, so it says so. */}
      {tier ? TIER_LABEL[tier] : "Not placed yet"}
    </Badge>
  )
}

export interface GroupColumn {
  label: string
  avg: number
  n: number
}

/** The two sides of a comparison, each with its average and how many days it rests on. */
export function GroupChips({ high, low }: { high: GroupColumn; low: GroupColumn }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[high, low].map((g, i) => (
        <div key={i} className="rounded-lg bg-secondary/50 px-3 py-2">
          {/* Two lines before it gives up: "all caffeine before 16:00" cut to
              "all caffeine before 1…" dropped the one part that mattered. */}
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide line-clamp-2 break-words mb-1">
            {g.label}
          </p>
          <p className="text-base font-bold text-foreground leading-none">{g.avg}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{g.n} days</p>
        </div>
      ))}
    </div>
  )
}
