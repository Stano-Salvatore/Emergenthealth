"use client"

import {
  Activity, Brain, Calendar, CheckSquare, FlaskConical, Footprints, GlassWater,
  LineChart, Moon, NotebookPen, Pill, Search, Sunrise, Tag, TrendingUp,
} from "lucide-react"
import type { SourceChip, SourceDomain } from "@/lib/chat-sources"
import { toolActivity } from "@/lib/chat-sources"

// Identity hues only — a source chip says WHAT was read, never whether the
// news is good, so status colours have no business here.
// Written out rather than interpolated so Tailwind can see the class names.
const DOMAIN_TEXT: Record<SourceDomain, string> = {
  sleep: "text-sleep",
  heart: "text-heart",
  move: "text-move",
  fuel: "text-fuel",
  mind: "text-mind",
  life: "text-life",
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  sleep: Moon,
  journal: NotebookPen,
  checkin: Sunrise,
  tags: Tag,
  intake: GlassWater,
  habits: CheckSquare,
  calendar: Calendar,
  symptoms: Activity,
  labs: FlaskConical,
  meds: Pill,
  workouts: Footprints,
  patterns: TrendingUp,
  memory: Brain,
  "tool:get_health_range": LineChart,
  "tool:find_my_logs": Search,
}

/**
 * What Emergy read to answer, under the answer. Every chip here is backed
 * server-side — either a tool the stream watched him call, or a section the
 * prompt actually carried (see src/lib/chat-sources.ts). There is deliberately
 * no way for this component to render a source he merely mentioned.
 */
export function SourceTrail({ chips }: { chips: SourceChip[] }) {
  if (chips.length === 0) return null
  return (
    <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-1.5">
      {chips.map(chip => {
        const Icon = ICONS[chip.key] ?? LineChart
        return (
          <span
            key={chip.key}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground"
          >
            <Icon className={`h-3 w-3 shrink-0 ${DOMAIN_TEXT[chip.domain]}`} />
            {chip.label}
            {chip.detail && <span className="text-muted-foreground/70">· {chip.detail}</span>}
          </span>
        )
      })}
    </div>
  )
}

/**
 * What he is doing right now. A blinking cursor makes a multi-second tool call
 * look like a hang; naming the tool turns the same wait into him working.
 */
export function ToolActivity({ tool }: { tool: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground">
      {toolActivity(tool)}
      <span className="flex gap-1" aria-hidden>
        <span className="h-1 w-1 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:0ms]" />
        <span className="h-1 w-1 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:150ms]" />
        <span className="h-1 w-1 rounded-full bg-muted-foreground animate-pulse [animation-delay:300ms]" />
      </span>
    </span>
  )
}
