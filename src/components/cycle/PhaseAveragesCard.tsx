// The user's own numbers by phase — what the ring and the check-ins show
// across the logged cycles. Averages, read as they are: no verdict on which
// phase is "better".

import { PHASES, type PhaseAverages } from "@/lib/cycle"
import { PHASE_GUIDE } from "@/lib/cycle-guide"
import { PHASE_HEX } from "./cycle-colors"

export interface AverageMetric { key: string; label: string; unit: string; decimals: number }

export function PhaseAveragesCard({ averages, metrics }: { averages: PhaseAverages; metrics: AverageMetric[] }) {
  const rows = metrics.filter(m => PHASES.filter(p => averages.byPhase[p][m.key]).length >= 2)
  if (averages.cycles < 2 || rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        After two complete cycles this shows your own sleep, HRV, resting heart rate, readiness, mood and energy in each phase
        {averages.cycles === 1 ? " — one cycle logged so far." : "."}
      </p>
    )
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th className="text-left font-normal py-1 px-1" />
            {PHASES.map(p => (
              <th key={p} className="font-normal py-1 px-1 text-right">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: PHASE_HEX[p] }} />{PHASE_GUIDE[p].name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map(m => (
            <tr key={m.key}>
              <td className="py-1.5 px-1 text-muted-foreground text-xs">{m.label}</td>
              {PHASES.map(p => {
                const v = averages.byPhase[p][m.key]
                return (
                  <td key={p} className="py-1.5 px-1 text-right tabular-nums">
                    {v ? `${v.mean.toFixed(m.decimals)}${m.unit}` : <span className="text-muted-foreground">—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-muted-foreground mt-2">From {averages.cycles} complete cycles with readings; each row needs two of them. A dash is a phase without five days of that reading.</p>
    </div>
  )
}
