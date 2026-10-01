// The cycle in words — one wording for the page, the home card and Emergy.
// Observations only: a late period is a count of days, never a reason.

import type { CycleSettings, CycleToday } from "@/lib/cycle"
import { PACKS } from "@/lib/cycle"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "25 Oct" — a local day, read as written, never shifted by a timezone. */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

function shortRange(a: string, b: string): string {
  const [, ma, da] = a.split("-").map(Number)
  const [, mb, db] = b.split("-").map(Number)
  return ma === mb ? `${da}–${db} ${MONTHS[mb - 1]}` : `${shortDay(a)} – ${shortDay(b)}`
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

const PACK_WORD: Partial<Record<CycleSettings["contraception"], string>> = { combined_pill: "Pill", ring: "Ring", patch: "Patch" }

export interface Headline { title: string; detail: string | null }

export function cycleHeadline(t: CycleToday, settings: CycleSettings): Headline {
  if (t.mode === "pack") {
    const word = PACK_WORD[settings.contraception] ?? "Pack"
    if (!t.pack) return { title: `${word} — set the pack start`, detail: "Add the day this pack started and the days line up." }
    const active = PACKS[settings.pack!.kind].active
    if (t.pack.active) {
      return {
        title: `${word} day ${t.pack.day} of ${t.pack.length}`,
        detail: t.pack.breakStartsIn != null ? `The break starts in ${plural(t.pack.breakStartsIn, "day")}.` : null,
      }
    }
    return {
      title: `Break week · day ${t.pack.day - active}`,
      detail: "A withdrawal bleed usually starts two to four days into the break.",
    }
  }

  if (!t.currentStart) return { title: "Log a period to start", detail: "Tap the day your last period started, and the cycle builds from there." }

  if (t.periodOngoing && t.periodDay != null) {
    return {
      title: `Period · day ${t.periodDay}`,
      detail: t.periodDay <= t.stats.periodLength ? `Yours usually lasts about ${plural(t.stats.periodLength, "day")}.` : null,
    }
  }

  if (t.lateBy > 0 && t.nextStart) {
    return { title: `Period ${plural(t.lateBy, "day")} later than expected`, detail: `It was expected around ${shortDay(t.nextStart)}.` }
  }

  if (t.daysUntilNext != null && t.daysUntilNext <= 2 && t.nextStart) {
    const title = t.daysUntilNext === 0 ? "Period expected today"
      : t.daysUntilNext === 1 ? "Period likely tomorrow"
      : `Period likely in ${t.daysUntilNext} days`
    return { title, detail: t.nextWindow ? `Most likely ${shortRange(t.nextWindow[0], t.nextWindow[1])}.` : null }
  }

  const next = t.nextStart ? `Next period around ${shortDay(t.nextStart)}` : null
  const day = t.cycleDay != null ? ` · day ${t.cycleDay}` : ""
  switch (t.phase) {
    case "ovulation":
      return {
        title: `Ovulation window${day}`,
        detail: t.ovulation
          ? t.ovulationConfirmed ? `Your temperature shows ovulation around ${shortDay(t.ovulation)}.` : `Ovulation estimated around ${shortDay(t.ovulation)}.`
          : null,
      }
    case "follicular":
      return {
        title: `Follicular${day}`,
        detail: t.ovulation ? `Ovulation estimated around ${shortDay(t.ovulation)}${next ? ` · ${next.toLowerCase()}` : ""}.` : next ? `${next}.` : null,
      }
    case "luteal":
      return {
        title: t.premenstrual ? `Premenstrual days${day}` : `Luteal${day}`,
        detail: next ? `${next}${t.nextWindow ? ` (${shortRange(t.nextWindow[0], t.nextWindow[1])})` : ""}.` : null,
      }
    default:
      return { title: `Cycle day ${t.cycleDay ?? "—"}`, detail: next ? `${next}.` : null }
  }
}

export interface HomeNote { title: string; detail: string | null; tip: string | null; tone: "period" | "soon" | "late" | "pack" }

/** Past a fortnight late, the likelier story is a period nobody logged. */
const LATE_SHOWN_DAYS = 14

const PERIOD_TIPS: string[] = [
  "Cramps usually peak in the first two days — heat on the belly and gentle movement help many.",
  "Day two is often the heaviest. Iron-rich food with some vitamin C helps replace what is lost.",
  "Energy often starts lifting from here as oestrogen climbs again.",
]

/**
 * The home page's line about the cycle — only on the days it matters: during
 * the period, the two days before it, a late period, and the pack's break.
 * Every other day the home page stays as it was.
 */
export function homeCycleNote(t: CycleToday, settings: CycleSettings): HomeNote | null {
  if (!settings.enabled) return null
  const h = cycleHeadline(t, settings)

  if (t.mode === "pack") {
    if (!t.pack) return null
    if (!t.pack.active) return { ...h, tip: null, tone: "pack" }
    if (t.pack.breakStartsIn != null && t.pack.breakStartsIn <= 1) return { ...h, tip: null, tone: "pack" }
    return null
  }

  if (t.periodOngoing && t.periodDay != null) {
    return { ...h, tip: PERIOD_TIPS[Math.min(t.periodDay, PERIOD_TIPS.length) - 1], tone: "period" }
  }
  if (t.lateBy > 0) {
    return t.lateBy <= LATE_SHOWN_DAYS ? { ...h, tip: "Logging the first day when it comes keeps the next prediction right.", tone: "late" } : null
  }
  if (t.daysUntilNext != null && t.daysUntilNext <= 2 && t.nextStart) {
    return { ...h, tip: "Worth having pads, tampons or a cup with you.", tone: "soon" }
  }
  return null
}

/** The night signals the luteal phase moves on its own: up, up, up, down. */
const LUTEAL_SIGNS = new Set(["skinTemp", "restingHR", "breathingRate", "hrv"])

/**
 * A line for the vitals card when the strain it reports is the shape the
 * luteal phase gives every cycle, so a warmer night with a faster heart is
 * read as the phase it is before it is read as anything else.
 */
export function lutealNote(t: CycleToday, signMetrics: string[]): string | null {
  if (t.phase !== "luteal" || !signMetrics.some(m => LUTEAL_SIGNS.has(m))) return null
  return "Luteal phase: a warmer body, a higher resting heart rate and a lower HRV are usual for these days."
}
