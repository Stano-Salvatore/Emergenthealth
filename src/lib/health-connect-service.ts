// Health Connect service — only runs inside the Capacitor Android WebView.
// Gracefully no-ops in browser / SSR context.
//
// Uses @kiwi-health/capacitor-health-connect which supports:
// Steps, SleepSession (+ stages), RestingHeartRate, HeartRateVariabilityRmssd,
// OxygenSaturation, Weight, ActiveCaloriesBurned, TotalCaloriesBurned.
//
// Sleep stage codes (Health Connect):
//   1 = AWAKE_IN_BED, 2 = SLEEPING, 3 = OUT_OF_BED,
//   4 = LIGHT_SLEEP, 5 = DEEP_SLEEP, 6 = REM_SLEEP

export type HCAvailability = "Available" | "NotInstalled" | "NotSupported"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plugin = any

async function getPlugin(): Promise<Plugin | null> {
  if (typeof window === "undefined") return null
  try {
    const mod = await import("@kiwi-health/capacitor-health-connect")
    return (mod as any).HealthConnect ?? null // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch {
    return null
  }
}

export async function checkAvailability(): Promise<HCAvailability> {
  const hc = await getPlugin()
  if (!hc) return "NotSupported"
  try {
    const { availability } = await hc.checkAvailability()
    return availability as HCAvailability
  } catch {
    return "NotSupported"
  }
}

const READ_TYPES = [
  "Steps",
  "SleepSession",
  "RestingHeartRate",
  "HeartRateVariabilityRmssd",
  "OxygenSaturation",
  "Weight",
  "ActiveCaloriesBurned",
  "TotalCaloriesBurned",
] as const

export async function requestPermissions(): Promise<boolean> {
  const hc = await getPlugin()
  if (!hc) return false
  try {
    const result = await hc.requestHealthPermissions({ read: [...READ_TYPES], write: [] })
    return result.hasAllPermissions === true
  } catch {
    return false
  }
}

export type DayPayload = {
  date: string           // "YYYY-MM-DD"
  steps?: number
  sleepDurationMin?: number
  deepSleepMin?: number
  remSleepMin?: number
  lightSleepMin?: number
  sleepStart?: string    // ISO
  sleepEnd?: string
  restingHR?: number
  hrv?: number
  spo2?: number
  weight?: number        // kg
  caloriesBurned?: number
  totalCalories?: number
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function avg(arr: number[]): number | undefined {
  if (!arr.length) return undefined
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

export async function readLast30Days(): Promise<DayPayload[]> {
  const hc = await getPlugin()
  if (!hc) return []

  const endTime = new Date()
  const startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const timeRangeFilter = { type: "between" as const, startTime, endTime }

  const dayMap = new Map<string, DayPayload>()
  const getDay = (d: string) => {
    if (!dayMap.has(d)) dayMap.set(d, { date: d })
    return dayMap.get(d)!
  }

  const hrMap = new Map<string, number[]>()
  const hrvMap = new Map<string, number[]>()
  const spo2Map = new Map<string, number[]>()

  async function safeRead(type: string) {
    try {
      const { records } = await hc.readRecords({ type, timeRangeFilter })
      return records as any[] // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch {
      return []
    }
  }

  // ── Steps (sum per day) ───────────────────────────────────────────────────
  for (const r of await safeRead("Steps")) {
    const d = dateStr(new Date(r.startTime))
    const day = getDay(d)
    day.steps = (day.steps ?? 0) + (r.count ?? 0)
  }

  // ── Sleep (longest session wins; stages summed) ───────────────────────────
  for (const r of await safeRead("SleepSession")) {
    const start = new Date(r.startTime)
    const end = new Date(r.endTime)
    const d = dateStr(end) // attribute sleep to wake-up day
    const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000)
    const day = getDay(d)
    if (!day.sleepDurationMin || durationMin > day.sleepDurationMin) {
      day.sleepDurationMin = durationMin
      day.sleepStart = start.toISOString()
      day.sleepEnd = end.toISOString()
      let light = 0, deep = 0, rem = 0
      for (const stage of r.stages ?? []) {
        const dur = Math.round(
          (new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime()) / 60_000
        )
        if (stage.stage === 4) light += dur
        else if (stage.stage === 5) deep += dur
        else if (stage.stage === 6) rem += dur
      }
      if (deep > 0) day.deepSleepMin = deep
      if (rem > 0) day.remSleepMin = rem
      if (light > 0) day.lightSleepMin = light
    }
  }

  // ── Resting HR (average per day) ─────────────────────────────────────────
  for (const r of await safeRead("RestingHeartRate")) {
    const d = dateStr(new Date(r.time))
    if (!hrMap.has(d)) hrMap.set(d, [])
    hrMap.get(d)!.push(r.beatsPerMinute ?? 0)
  }

  // ── HRV (average per day) ─────────────────────────────────────────────────
  for (const r of await safeRead("HeartRateVariabilityRmssd")) {
    const d = dateStr(new Date(r.time))
    if (!hrvMap.has(d)) hrvMap.set(d, [])
    hrvMap.get(d)!.push(r.heartRateVariabilityMillis ?? 0)
  }

  // ── SpO₂ (average per day) ───────────────────────────────────────────────
  for (const r of await safeRead("OxygenSaturation")) {
    const d = dateStr(new Date(r.time))
    if (!spo2Map.has(d)) spo2Map.set(d, [])
    spo2Map.get(d)!.push(r.percentage?.value ?? 0)
  }

  // ── Weight (latest per day) ───────────────────────────────────────────────
  for (const r of await safeRead("Weight")) {
    const d = dateStr(new Date(r.time))
    const kg = r.weight?.unit === "kilogram"
      ? r.weight.value
      : r.weight?.unit === "pound"
        ? r.weight.value * 0.453592
        : r.weight?.unit === "gram"
          ? r.weight.value / 1000
          : null
    if (kg != null) getDay(d).weight = Math.round(kg * 10) / 10
  }

  // ── Active calories (sum per day) ─────────────────────────────────────────
  for (const r of await safeRead("ActiveCaloriesBurned")) {
    const d = dateStr(new Date(r.startTime))
    const day = getDay(d)
    const kcal = toKcal(r.energy)
    day.caloriesBurned = (day.caloriesBurned ?? 0) + kcal
  }

  // ── Total calories (sum per day) ──────────────────────────────────────────
  for (const r of await safeRead("TotalCaloriesBurned")) {
    const d = dateStr(new Date(r.startTime))
    const day = getDay(d)
    const kcal = toKcal(r.energy)
    day.totalCalories = (day.totalCalories ?? 0) + kcal
  }

  // Merge averaged metrics
  for (const [d, vals] of hrMap) {
    const a = avg(vals); if (a != null) getDay(d).restingHR = Math.round(a)
  }
  for (const [d, vals] of hrvMap) {
    const a = avg(vals); if (a != null) getDay(d).hrv = Math.round(a * 10) / 10
  }
  for (const [d, vals] of spo2Map) {
    const a = avg(vals); if (a != null) getDay(d).spo2 = Math.round(a * 10) / 10
  }

  return [...dayMap.values()]
}

function toKcal(energy: { unit: string; value: number } | null | undefined): number {
  if (!energy) return 0
  switch (energy.unit) {
    case "kilocalories": return Math.round(energy.value)
    case "calories":     return Math.round(energy.value / 1000)
    case "joules":       return Math.round(energy.value / 4184)
    case "kilojoules":   return Math.round(energy.value / 4.184)
    default:             return 0
  }
}

export async function syncToServer(): Promise<{ synced: number }> {
  const days = await readLast30Days()
  if (days.length === 0) return { synced: 0 }
  const res = await fetch("/api/sync/health-connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  })
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`)
  const data = await res.json()
  return { synced: data.synced ?? days.length }
}
