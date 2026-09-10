// Which check-in the Check-in tab should open on, and the small shared bits
// the evening one needs.
//
// One route and one nav row for both, chosen by the clock. A second tab called
// "Evening" would be a row that is wrong for most of the day, and the sidebar
// already lost five rows for exactly that reason.

export type CheckInMode = "morning" | "evening"

/** Evening from 17:00. Before that the morning check-in is the useful one. */
export const EVENING_FROM_HOUR = 17

export function checkInModeFor(hour: number): CheckInMode {
  return hour >= EVENING_FROM_HOUR ? "evening" : "morning"
}

/** Local "YYYY-MM-DD" from a Date, without going through UTC. */
export function localDayOf(d: Date = new Date()): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-")
}

/** Tomorrow, for the things not to forget. */
export function tomorrowOf(d: Date = new Date()): string {
  const t = new Date(d)
  t.setDate(t.getDate() + 1)
  return localDayOf(t)
}

/**
 * The same starting vocabulary the Symptoms page offers.
 *
 * Shared rather than copied: two lists that drift mean the evening check-in
 * quietly stops matching the names the Insights engine has been correlating.
 */
export const SYMPTOM_STARTERS = [
  "Headache", "Fatigue", "Brain fog", "Nausea", "Anxiety",
  "Back pain", "Stomach ache", "Dizziness", "Sore throat", "Insomnia",
] as const

export const SYMPTOM_SEVERITY = [
  { value: 1, label: "Barely", color: "bg-emerald-500" },
  { value: 2, label: "Mild", color: "bg-lime-500" },
  { value: 3, label: "Moderate", color: "bg-amber-500" },
  { value: 4, label: "Bad", color: "bg-orange-500" },
  { value: 5, label: "Severe", color: "bg-red-500" },
] as const

// ── The evening's question about the morning's intention ────────────────────
// The morning check-in asks what you mean to do; nothing asked whether you
// did it. This is the one line that closes the loop, shared by the evening
// push, the phone's local nudge and Emergy, so the three never phrase it
// three ways.

export type IntentionOutcome = "done" | "partly" | "no"
export const INTENTION_OUTCOMES: readonly IntentionOutcome[] = ["done", "partly", "no"]

/** Notification-length, with the intention quoted so the question is specific. */
export function intentionQuestion(intention: string, max = 90): string {
  const flat = intention.replace(/\s+/g, " ").trim()
  const shown = flat.length > max ? flat.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : flat
  return `This morning you set out to "${shown}" — how did it go?`
}
