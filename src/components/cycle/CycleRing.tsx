// The cycle as a ring: one arc per phase, sized by the user's own days, and a marker
// on today. Under hormonal contraception only the period arc is coloured —
// there is no ovulation to draw.

import type { Phase } from "@/lib/cycle"
import { NEUTRAL_HEX, PHASE_HEX } from "./cycle-colors"

interface Props {
  cycleLength: number
  periodLength: number
  /** Cycle day of ovulation, or null when there is none to show. */
  ovulationDay: number | null
  cycleDay: number | null
  center: string
  sub: string
  /** On the pill, ring or patch the ring is the pack: active days, then the break. */
  pack?: { active: number; length: number; day: number } | null
}

const PACK_ACTIVE_HEX = PHASE_HEX.luteal
const PACK_BREAK_HEX = PHASE_HEX.menstrual

const SIZE = 200
const R = 82
const STROKE = 14

function phaseOfDay(d: number, periodLength: number, ovulationDay: number | null): Phase | null {
  if (d <= periodLength) return "menstrual"
  if (ovulationDay == null) return null
  if (Math.abs(d - ovulationDay) <= 1) return "ovulation"
  return d < ovulationDay ? "follicular" : "luteal"
}

function point(angle: number): [number, number] {
  const a = (angle - 90) * (Math.PI / 180)
  return [SIZE / 2 + R * Math.cos(a), SIZE / 2 + R * Math.sin(a)]
}

function arc(from: number, to: number): string {
  const [x1, y1] = point(from)
  const [x2, y2] = point(to)
  return `M ${x1} ${y1} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

export function CycleRing({ cycleLength, periodLength, ovulationDay, cycleDay, center, sub, pack }: Props) {
  const len = Math.max(pack ? pack.length : cycleLength, 1)
  const per = 360 / len
  const colourOf = (d: number): string => {
    if (pack) return d <= pack.active ? PACK_ACTIVE_HEX : PACK_BREAK_HEX
    const p = phaseOfDay(d, periodLength, ovulationDay)
    return p ? PHASE_HEX[p] : NEUTRAL_HEX
  }
  // Runs of consecutive days in one colour become one arc each.
  const runs: { colour: string; from: number; to: number }[] = []
  for (let d = 1; d <= len; d++) {
    const c = colourOf(d)
    const last = runs[runs.length - 1]
    if (last && last.colour === c) last.to = d
    else runs.push({ colour: c, from: d, to: d })
  }
  const GAP = 1.2
  const day = pack ? pack.day : cycleDay
  const marker = day != null ? point((Math.min(day, len) - 0.5) * per) : null
  const markerColour = day != null ? colourOf(Math.min(day, len)) : NEUTRAL_HEX

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-48 h-48 shrink-0" role="img" aria-label={`${center}, ${sub}`}>
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={STROKE} />
      {runs.map(r => (
        <path
          key={r.from}
          d={arc((r.from - 1) * per + GAP / 2, r.to * per - GAP / 2)}
          fill="none"
          stroke={r.colour}
          strokeOpacity={r.colour === NEUTRAL_HEX ? 0.35 : 0.85}
          strokeWidth={STROKE}
          strokeLinecap="butt"
        />
      ))}
      {marker && (
        <circle cx={marker[0]} cy={marker[1]} r={STROKE / 2 + 3} fill="var(--background, #0b0b12)"
          stroke={markerColour} strokeWidth={4} />
      )}
      <text x="50%" y="47%" textAnchor="middle" className="fill-foreground" style={{ fontSize: 30, fontWeight: 800 }}>{center}</text>
      <text x="50%" y="60%" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>{sub}</text>
    </svg>
  )
}
