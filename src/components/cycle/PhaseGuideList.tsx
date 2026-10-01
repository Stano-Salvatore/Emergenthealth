"use client"

// Every phase, in order, on the user's own days — the current one open. Each says
// what is happening, what many people notice, and what tends to help with
// food, movement, sleep and medicines.

import { useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { PHASES, type CycleMode, type Phase } from "@/lib/cycle"
import { PHASE_GUIDE, PREMENSTRUAL } from "@/lib/cycle-guide"
import { shortDay } from "@/lib/cycle-text"
import { PHASE_HEX } from "./cycle-colors"

interface Props {
  current: Phase | null
  premenstrual: boolean
  /** The user's own day ranges, e.g. { menstrual: "Days 1–5" }. */
  days: Partial<Record<Phase, string>>
  mode: CycleMode
  ferritin: { value: number; unit: string; date: string; flag: string | null; qualifier: string | null } | null
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</p>
      <ul className="space-y-1">
        {items.map(i => <li key={i} className="text-sm leading-snug flex gap-2"><span className="text-muted-foreground">·</span><span>{i}</span></li>)}
      </ul>
    </div>
  )
}

export function PhaseGuideList({ current, premenstrual, days, mode, ferritin }: Props) {
  const [open, setOpen] = useState<Phase | null>(current ?? "menstrual")

  return (
    <div className="space-y-2">
      {mode !== "natural" && (
        <p className="text-xs text-muted-foreground rounded-lg border border-dashed px-3 py-2">
          {mode === "pack"
            ? "On the combined pill, ring or patch these phases are paused — the hormones stay steady and the break-week bleed is a withdrawal bleed. They are here for reference."
            : "Hormonal contraception can change or pause these phases; many people on a hormonal coil still go through them. Use them as a guide, not a schedule."}
        </p>
      )}
      {PHASES.map(phase => {
        const g = PHASE_GUIDE[phase]
        const isOpen = open === phase
        const here = current === phase
        return (
          <div key={phase} className={cn("rounded-xl border", here && "border-primary/40")}>
            <button onClick={() => setOpen(isOpen ? null : phase)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: PHASE_HEX[phase] }} />
              <span className="flex-1 min-w-0">
                <span className="text-sm font-semibold">{g.emoji} {g.name}</span>
                <span className="text-xs text-muted-foreground"> · {days[phase] ?? g.typicalDays}</span>
              </span>
              {here && <span className="text-[10px] rounded-full bg-primary/15 text-primary px-2 py-0.5 shrink-0">{premenstrual && phase === "luteal" ? "premenstrual" : "now"}</span>}
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <div className="px-3 pb-3 space-y-3">
                <p className="text-sm text-muted-foreground leading-snug">{g.summary} {g.hormones}</p>
                <Section title="What many notice" items={g.expect} />
                {phase === "luteal" && (
                  <div className={cn("rounded-lg border px-3 py-2 space-y-2", premenstrual && "border-primary/40 bg-primary/5")}>
                    <p className="text-xs font-semibold">{PREMENSTRUAL.name} — the last five or so before the period</p>
                    <Section title="Often" items={PREMENSTRUAL.expect} />
                    <Section title="What tends to help" items={PREMENSTRUAL.helps} />
                  </div>
                )}
                <Section title="Food" items={g.food} />
                <Section title="Movement" items={g.movement} />
                <Section title="Sleep" items={g.sleep} />
                <Section title="Medicines & supplements" items={g.medicines} />
                {phase === "menstrual" && ferritin && (
                  <p className="text-xs rounded-lg bg-muted/50 px-3 py-2">
                    Your last ferritin (iron stores) was <span className="font-semibold tabular-nums">{ferritin.qualifier ?? ""}{ferritin.value} {ferritin.unit}</span> on {shortDay(ferritin.date)}
                    {ferritin.flag === "low" ? ", marked low by the lab" : ""}. <Link href="/dashboard/health?tab=labs" className="text-primary underline">Labs</Link>
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link href="/dashboard/intake?tab=food" className="text-xs rounded-full bg-primary/10 text-primary px-2.5 py-1">Food →</Link>
                  <Link href="/dashboard/intake?tab=body" className="text-xs rounded-full bg-primary/10 text-primary px-2.5 py-1">In my body →</Link>
                  <Link href="/dashboard/chat" className="text-xs rounded-full bg-primary/10 text-primary px-2.5 py-1">Ask Emergy →</Link>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
