// This cycle's nights on the ring's temperature, with ovulation marked: the
// rise after ovulation is the one sign of it the body shows on its own.

import type { DayValue } from "@/lib/cycle"
import { daysBetween } from "@/lib/cycle"
import { PHASE_HEX } from "./cycle-colors"

const W = 320
const H = 110
const PAD = 14

export function TempChart({ temps, start, ovulation, confirmed }: { temps: DayValue[]; start: string; ovulation: string | null; confirmed: boolean }) {
  if (temps.length < 5) return null
  const xs = temps.map(t => daysBetween(start, t.date) + 1)
  const ys = temps.map(t => t.value)
  const maxX = Math.max(28, ...xs)
  const lo = Math.min(...ys, -0.2)
  const hi = Math.max(...ys, 0.4)
  const x = (d: number) => PAD + ((d - 1) / (maxX - 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2)
  const path = temps.map((t, i) => `${i === 0 ? "M" : "L"} ${x(xs[i]).toFixed(1)} ${y(t.value).toFixed(1)}`).join(" ")
  const ovuX = ovulation ? x(daysBetween(start, ovulation) + 1) : null

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Temperature this cycle">
        <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="3 3" />
        {ovuX != null && (
          <line x1={ovuX} x2={ovuX} y1={PAD / 2} y2={H - PAD} stroke={PHASE_HEX.ovulation} strokeWidth={1.5} strokeDasharray={confirmed ? undefined : "4 3"} />
        )}
        <path d={path} fill="none" stroke={PHASE_HEX.luteal} strokeWidth={2} />
        {temps.map((t, i) => <circle key={t.date} cx={x(xs[i])} cy={y(t.value)} r={2.2} fill={PHASE_HEX.luteal} />)}
      </svg>
      <figcaption className="text-[10px] text-muted-foreground mt-1">
        Skin temperature against your usual (dashed line at 0), by cycle day.
        {ovulation ? (confirmed ? " The solid line is where the rise shows ovulation." : " The dashed line is the estimated ovulation.") : ""}
      </figcaption>
    </figure>
  )
}
