import pg from "pg"

const { Pool } = pg

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL environment variable is required")
    pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } })
  }
  return pool
}

export interface HealthRow {
  id: string
  date: string
  sleep_duration: number | null   // minutes
  deep_sleep: number | null       // minutes
  rem_sleep: number | null        // minutes
  light_sleep: number | null      // minutes
  steps: number | null
  calories_burned: number | null
  active_minutes: number | null
  resting_hr: number | null
  weight: number | null
  workouts: unknown | null
  synced_at: string
}

export async function getLatestLog(): Promise<HealthRow | null> {
  const { rows } = await getPool().query<HealthRow>(
    `SELECT id, date, "sleepDuration" AS sleep_duration, "deepSleep" AS deep_sleep,
            "remSleep" AS rem_sleep, "lightSleep" AS light_sleep, steps,
            "caloriesBurned" AS calories_burned, "activeMinutes" AS active_minutes,
            "restingHR" AS resting_hr, weight, workouts, "syncedAt" AS synced_at
     FROM "HealthLog"
     ORDER BY date DESC
     LIMIT 1`
  )
  return rows[0] ?? null
}

export async function getLogs(days: number): Promise<HealthRow[]> {
  const { rows } = await getPool().query<HealthRow>(
    `SELECT id, date, "sleepDuration" AS sleep_duration, "deepSleep" AS deep_sleep,
            "remSleep" AS rem_sleep, "lightSleep" AS light_sleep, steps,
            "caloriesBurned" AS calories_burned, "activeMinutes" AS active_minutes,
            "restingHR" AS resting_hr, weight, workouts, "syncedAt" AS synced_at
     FROM "HealthLog"
     ORDER BY date DESC
     LIMIT $1`,
    [Math.min(days, 90)]
  )
  return rows
}

export async function getLogsByDateRange(from: string, to: string): Promise<HealthRow[]> {
  const { rows } = await getPool().query<HealthRow>(
    `SELECT id, date, "sleepDuration" AS sleep_duration, "deepSleep" AS deep_sleep,
            "remSleep" AS rem_sleep, "lightSleep" AS light_sleep, steps,
            "caloriesBurned" AS calories_burned, "activeMinutes" AS active_minutes,
            "restingHR" AS resting_hr, weight, workouts, "syncedAt" AS synced_at
     FROM "HealthLog"
     WHERE date >= $1 AND date <= $2
     ORDER BY date DESC`,
    [from, to]
  )
  return rows
}

export interface UpsertHealthData {
  userId: string
  date: string
  sleepDuration?: number
  deepSleep?: number
  remSleep?: number
  lightSleep?: number
  steps?: number
  caloriesBurned?: number
  activeMinutes?: number
  restingHR?: number
  weight?: number
  workouts?: unknown
}

export async function upsertHealthLog(data: UpsertHealthData): Promise<HealthRow> {
  const pool = getPool()

  // Resolve userId if given an email
  let userId = data.userId
  if (userId.includes("@")) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
      [userId]
    )
    if (!rows[0]) throw new Error(`No user found with email: ${userId}`)
    userId = rows[0].id
  }

  const dateObj = new Date(data.date)
  dateObj.setUTCHours(0, 0, 0, 0)

  const { rows } = await pool.query<HealthRow>(
    `INSERT INTO "HealthLog" (
       id, "userId", date,
       "sleepDuration", "deepSleep", "remSleep", "lightSleep",
       steps, "caloriesBurned", "activeMinutes", "restingHR",
       weight, workouts, "syncedAt"
     ) VALUES (
       gen_random_uuid(), $1, $2,
       $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12, NOW()
     )
     ON CONFLICT ("userId", date) DO UPDATE SET
       "sleepDuration"  = COALESCE($3,  "HealthLog"."sleepDuration"),
       "deepSleep"      = COALESCE($4,  "HealthLog"."deepSleep"),
       "remSleep"       = COALESCE($5,  "HealthLog"."remSleep"),
       "lightSleep"     = COALESCE($6,  "HealthLog"."lightSleep"),
       steps            = COALESCE($7,  "HealthLog".steps),
       "caloriesBurned" = COALESCE($8,  "HealthLog"."caloriesBurned"),
       "activeMinutes"  = COALESCE($9,  "HealthLog"."activeMinutes"),
       "restingHR"      = COALESCE($10, "HealthLog"."restingHR"),
       weight           = COALESCE($11, "HealthLog".weight),
       workouts         = COALESCE($12, "HealthLog".workouts),
       "syncedAt"       = NOW()
     RETURNING
       id, date, "sleepDuration" AS sleep_duration, "deepSleep" AS deep_sleep,
       "remSleep" AS rem_sleep, "lightSleep" AS light_sleep, steps,
       "caloriesBurned" AS calories_burned, "activeMinutes" AS active_minutes,
       "restingHR" AS resting_hr, weight, workouts, "syncedAt" AS synced_at`,
    [
      userId, dateObj,
      data.sleepDuration ?? null,
      data.deepSleep ?? null,
      data.remSleep ?? null,
      data.lightSleep ?? null,
      data.steps ?? null,
      data.caloriesBurned ?? null,
      data.activeMinutes ?? null,
      data.restingHR ?? null,
      data.weight ?? null,
      data.workouts ? JSON.stringify(data.workouts) : null,
    ]
  )
  return rows[0]
}

// ── aggregation helpers ────────────────────────────────────────────────────

function numAvg(vals: (number | null)[]): number | null {
  const clean = vals.filter((v): v is number => v != null)
  return clean.length ? Math.round(clean.reduce((a, b) => a + b, 0) / clean.length) : null
}

function numMin(vals: (number | null)[]): number | null {
  const clean = vals.filter((v): v is number => v != null)
  return clean.length ? Math.min(...clean) : null
}

function numMax(vals: (number | null)[]): number | null {
  const clean = vals.filter((v): v is number => v != null)
  return clean.length ? Math.max(...clean) : null
}

export interface SleepAnalysis {
  period_days: number
  days_with_data: number
  avg_total_hours: number | null
  avg_deep_min: number | null
  avg_rem_min: number | null
  avg_light_min: number | null
  min_sleep_hours: number | null
  max_sleep_hours: number | null
  daily: Array<{
    date: string
    total_hours: number | null
    deep_min: number | null
    rem_min: number | null
    light_min: number | null
  }>
}

export function buildSleepAnalysis(rows: HealthRow[], days: number): SleepAnalysis {
  const daily = rows.map(r => ({
    date: typeof r.date === "string" ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10),
    total_hours: r.sleep_duration != null ? Math.round((r.sleep_duration / 60) * 10) / 10 : null,
    deep_min: r.deep_sleep,
    rem_min: r.rem_sleep,
    light_min: r.light_sleep,
  }))

  const withSleep = daily.filter(d => d.total_hours != null)

  return {
    period_days: days,
    days_with_data: withSleep.length,
    avg_total_hours: (() => {
      const v = numAvg(withSleep.map(d => d.total_hours != null ? Math.round(d.total_hours * 60) : null))
      return v != null ? Math.round(v / 60 * 10) / 10 : null
    })(),
    avg_deep_min: numAvg(daily.map(d => d.deep_min)),
    avg_rem_min: numAvg(daily.map(d => d.rem_min)),
    avg_light_min: numAvg(daily.map(d => d.light_min)),
    min_sleep_hours: numMin(withSleep.map(d => d.total_hours)),
    max_sleep_hours: numMax(withSleep.map(d => d.total_hours)),
    daily,
  }
}

export interface ActivityStats {
  period_days: number
  days_with_data: number
  avg_steps: number | null
  avg_calories: number | null
  avg_active_minutes: number | null
  total_steps: number | null
  daily: Array<{
    date: string
    steps: number | null
    calories: number | null
    active_minutes: number | null
  }>
}

export function buildActivityStats(rows: HealthRow[], days: number): ActivityStats {
  const daily = rows.map(r => ({
    date: typeof r.date === "string" ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10),
    steps: r.steps,
    calories: r.calories_burned,
    active_minutes: r.active_minutes,
  }))

  const withSteps = daily.filter(d => d.steps != null)
  const totalSteps = withSteps.reduce((s, d) => s + (d.steps ?? 0), 0)

  return {
    period_days: days,
    days_with_data: withSteps.length,
    avg_steps: numAvg(daily.map(d => d.steps)),
    avg_calories: numAvg(daily.map(d => d.calories)),
    avg_active_minutes: numAvg(daily.map(d => d.active_minutes)),
    total_steps: withSteps.length ? totalSteps : null,
    daily,
  }
}

export interface HRStats {
  period_days: number
  days_with_data: number
  avg_resting_hr: number | null
  min_resting_hr: number | null
  max_resting_hr: number | null
  daily: Array<{ date: string; resting_hr: number | null }>
}

export function buildHRStats(rows: HealthRow[], days: number): HRStats {
  const daily = rows.map(r => ({
    date: typeof r.date === "string" ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10),
    resting_hr: r.resting_hr,
  }))

  return {
    period_days: days,
    days_with_data: daily.filter(d => d.resting_hr != null).length,
    avg_resting_hr: numAvg(daily.map(d => d.resting_hr)),
    min_resting_hr: numMin(daily.map(d => d.resting_hr)),
    max_resting_hr: numMax(daily.map(d => d.resting_hr)),
    daily,
  }
}
