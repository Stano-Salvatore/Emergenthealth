// Changing a medication schedule by talking about it — "add a 21:00 Elicea",
// "only weekdays now", "I stopped the Atarax".
//
// Emergy could create a schedule but not touch one, so every change went
// "edit it on the Medications page". This is the edit as a pure plan: which
// schedule the words mean, and what would change. The caller writes it.

import { fold } from "@/lib/supplement-normalize"
import { matchKey, minutesOfDay } from "@/lib/med-schedule"

export interface EditableSchedule {
  id: string
  name: string
  dose: string | null
  times: string[]
  daysOfWeek: number[]
  active: boolean
  remind: boolean
  note: string | null
  startDate: string | null
  endDate: string | null
}

export interface ScheduleEdit {
  addTimes?: string[]
  removeTimes?: string[]
  /** Replaces every time. */
  times?: string[]
  daysOfWeek?: number[]
  dose?: string | null
  note?: string | null
  remind?: boolean
  /** paused: kept, not expected, not reminded. stopped: ended today. */
  status?: "active" | "paused" | "stopped"
}

export type EditPlan =
  | { ok: true; data: Partial<EditableSchedule>; summary: string }
  | { ok: false; reason: string }

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
const MAX_TIMES = 6
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** "8:00" and "08:00" are one time; anything not a clock time is dropped. */
export function normalizeTimes(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const t of input) {
    if (typeof t !== "string") continue
    const m = TIME_RE.exec(t.trim())
    if (m) seen.add(`${m[1].padStart(2, "0")}:${m[2]}`)
  }
  return [...seen].sort((a, b) => minutesOfDay(a) - minutesOfDay(b)).slice(0, MAX_TIMES)
}

/** Every day is stored as no restriction, so the two can't disagree. */
export function normalizeDays(input: unknown): number[] {
  if (!Array.isArray(input)) return []
  const set = new Set<number>()
  for (const d of input) {
    const n = Number(d)
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n)
  }
  return set.size === 7 ? [] : [...set].sort()
}

export function describeDays(days: number[]): string {
  return days.length === 0 || days.length === 7 ? "daily" : days.map(d => DOW[d]).join("/")
}

// "Elicea 10mg" and "Elicea 10 mg" are one name; so are "Atarax," and "atarax".
function words(name: string): string {
  return fold(name).replace(/(\d)\s+(mg|mcg|µg|g|iu|ml)\b/g, "$1$2").replace(/[^a-z0-9]+/g, " ").trim()
}

/**
 * The schedules a spoken name could mean. An exact name wins outright; then
 * the same substance ("vit d" for Vitamin D); then any schedule whose name
 * contains the words. More than one back means ask which.
 */
export function findSchedules<T extends { name: string }>(schedules: T[], query: string): T[] {
  const q = words(query)
  if (!q) return []
  const exact = schedules.filter(s => words(s.name) === q)
  if (exact.length > 0) return exact
  const key = matchKey(query)
  const same = schedules.filter(s => matchKey(s.name) === key)
  if (same.length > 0) return same
  const re = new RegExp(`(^| )${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`)
  return schedules.filter(s => re.test(words(s.name)))
}

export function planScheduleEdit(s: EditableSchedule, edit: ScheduleEdit, today: string): EditPlan {
  const data: Partial<EditableSchedule> = {}
  const said: string[] = []

  if (edit.times !== undefined || edit.addTimes !== undefined || edit.removeTimes !== undefined) {
    let times = edit.times !== undefined ? normalizeTimes(edit.times) : [...s.times]
    if (edit.times !== undefined && times.length === 0) return { ok: false, reason: "None of those is a time of day (HH:MM)." }
    if (edit.addTimes !== undefined) {
      const add = normalizeTimes(edit.addTimes)
      if (add.length === 0) return { ok: false, reason: "None of those is a time of day (HH:MM)." }
      times = normalizeTimes([...times, ...add])
    }
    if (edit.removeTimes !== undefined) {
      const drop = new Set(normalizeTimes(edit.removeTimes))
      times = times.filter(t => !drop.has(t))
      if (times.length === 0) return { ok: false, reason: `That would leave ${s.name} with no time at all — pause or stop it instead.` }
    }
    const before = normalizeTimes(s.times)
    if (times.join() !== before.join()) {
      data.times = times
      said.push(`times ${times.join(", ")}`)
    }
  }

  if (edit.daysOfWeek !== undefined) {
    const days = normalizeDays(edit.daysOfWeek)
    if (days.join() !== normalizeDays(s.daysOfWeek).join()) {
      data.daysOfWeek = days
      said.push(describeDays(days))
    }
  }

  if (edit.dose !== undefined) {
    const dose = edit.dose?.trim() ? edit.dose.trim().slice(0, 40) : null
    if (dose !== s.dose) { data.dose = dose; said.push(dose ? `dose ${dose}` : "no dose") }
  }

  if (edit.note !== undefined) {
    const note = edit.note?.trim() ? edit.note.trim().slice(0, 200) : null
    if (note !== s.note) { data.note = note; said.push(note ? `note "${note}"` : "note cleared") }
  }

  if (edit.remind !== undefined && edit.remind !== s.remind) {
    data.remind = edit.remind
    said.push(edit.remind ? "reminders on" : "reminders off")
  }

  if (edit.status === "paused" && s.active) {
    data.active = false
    said.push("paused — no reminders and nothing expected until it is resumed")
  } else if (edit.status === "stopped" && (s.active || s.endDate !== today)) {
    // Ended rather than deleted: the doses it expected before today still
    // count, and the doctor report lists it as stopped.
    data.active = false
    data.endDate = today
    said.push(`stopped as of ${today}`)
  } else if (edit.status === "active" && !s.active) {
    data.active = true
    if (s.endDate) data.endDate = null
    said.push("resumed")
  }

  if (said.length === 0) return { ok: false, reason: `${s.name} is already set that way — nothing to change.` }
  return { ok: true, data, summary: `${s.name}: ${said.join("; ")}.` }
}
