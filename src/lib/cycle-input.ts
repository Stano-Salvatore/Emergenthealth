// What a logged cycle day may contain, checked the same way for the page and
// for Emergy. Unknown values are dropped rather than stored: a symptom list
// that grows free text is one the averages can never count.

import { addDaysISO } from "@/lib/local-date"
import { FLOWS, type Flow } from "@/lib/cycle"

export const CYCLE_SYMPTOMS = [
  { key: "cramps", label: "Cramps", emoji: "🌀" },
  { key: "back_pain", label: "Back pain", emoji: "🔙" },
  { key: "headache", label: "Headache", emoji: "🤕" },
  { key: "bloating", label: "Bloating", emoji: "🎈" },
  { key: "breast_tenderness", label: "Tender breasts", emoji: "💗" },
  { key: "acne", label: "Breakouts", emoji: "🔴" },
  { key: "fatigue", label: "Tired", emoji: "🥱" },
  { key: "cravings", label: "Cravings", emoji: "🍫" },
  { key: "nausea", label: "Nausea", emoji: "🤢" },
  { key: "gut", label: "Upset stomach", emoji: "🌪️" },
  { key: "poor_sleep", label: "Poor sleep", emoji: "🌙" },
  { key: "dizzy", label: "Dizzy", emoji: "💫" },
  { key: "ovulation_pain", label: "Ovulation twinge", emoji: "📍" },
] as const

export const CYCLE_MOODS = [
  { key: "happy", label: "Happy", emoji: "😊" },
  { key: "calm", label: "Calm", emoji: "😌" },
  { key: "energetic", label: "Energetic", emoji: "⚡" },
  { key: "irritable", label: "Irritable", emoji: "😤" },
  { key: "anxious", label: "Anxious", emoji: "😰" },
  { key: "sad", label: "Low", emoji: "😔" },
  { key: "mood_swings", label: "Up and down", emoji: "🎢" },
  { key: "sensitive", label: "Sensitive", emoji: "🥺" },
] as const

export const DISCHARGES = [
  { key: "dry", label: "Dry" },
  { key: "sticky", label: "Sticky" },
  { key: "creamy", label: "Creamy" },
  { key: "watery", label: "Watery" },
  { key: "eggwhite", label: "Egg white" },
] as const

export const PAIN_LABELS = ["None", "Mild", "Moderate", "Severe"] as const

export interface DayData {
  flow?: Flow | null
  pain?: number | null
  symptoms?: string[]
  moods?: string[]
  discharge?: string | null
  lhTest?: "positive" | "negative" | null
  note?: string | null
}

const HISTORY_DAYS = 400
const SYMPTOM_KEYS = new Set<string>(CYCLE_SYMPTOMS.map(s => s.key))
const MOOD_KEYS = new Set<string>(CYCLE_MOODS.map(s => s.key))
const DISCHARGE_KEYS = new Set<string>(DISCHARGES.map(d => d.key))

const known = (v: unknown, keys: Set<string>): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && keys.has(x)))] : []

export function parseDayInput(body: unknown, today: string): { ok: true; day: string; data: DayData } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const day = typeof b.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : null
  if (!day) return { ok: false, error: "day must be YYYY-MM-DD" }
  if (day > today) return { ok: false, error: "That day hasn't happened yet." }
  if (day < addDaysISO(today, -HISTORY_DAYS)) return { ok: false, error: "That's further back than the cycle history goes." }

  const data: DayData = {}
  if ("flow" in b) {
    if (b.flow === null) data.flow = null
    else if (FLOWS.includes(b.flow as Flow)) data.flow = b.flow as Flow
  }
  if ("pain" in b) {
    if (b.pain === null) data.pain = null
    else if (typeof b.pain === "number" && Number.isInteger(b.pain) && b.pain >= 0 && b.pain <= 3) data.pain = b.pain
  }
  if ("symptoms" in b) {
    const s = known(b.symptoms, SYMPTOM_KEYS)
    if (s.length > 0 || (Array.isArray(b.symptoms) && b.symptoms.length === 0)) data.symptoms = s
  }
  if ("moods" in b) {
    const m = known(b.moods, MOOD_KEYS)
    if (m.length > 0 || (Array.isArray(b.moods) && b.moods.length === 0)) data.moods = m
  }
  if ("discharge" in b) {
    if (b.discharge === null) data.discharge = null
    else if (typeof b.discharge === "string" && DISCHARGE_KEYS.has(b.discharge)) data.discharge = b.discharge
  }
  if ("lhTest" in b) {
    if (b.lhTest === null) data.lhTest = null
    else if (b.lhTest === "positive" || b.lhTest === "negative") data.lhTest = b.lhTest
  }
  if ("note" in b) {
    data.note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null
  }
  return { ok: true, day, data }
}

/** The day after an update. `union` adds symptoms and moods instead of replacing them. */
export function mergeDay(existing: DayData, update: DayData, opts: { union?: boolean } = {}): DayData {
  const out: DayData = { ...existing }
  for (const [k, v] of Object.entries(update) as [keyof DayData, unknown][]) {
    if ((k === "symptoms" || k === "moods") && opts.union) {
      out[k] = [...new Set([...(existing[k] ?? []), ...((v as string[]) ?? [])])]
    } else {
      (out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

export function isEmptyDay(d: DayData): boolean {
  return d.flow == null && d.pain == null && !(d.symptoms?.length) && !(d.moods?.length)
    && d.discharge == null && d.lhTest == null && !d.note
}
