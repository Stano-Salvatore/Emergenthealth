// Runs once when the server starts (Next.js instrumentation hook).
//
// Seventy-odd environment variables are read across the app and four of them
// decide whether it works at all. A missing one used to show up as a 503 from
// every cron, an auth error on sign-in, or Emergy silently answering nothing —
// each discovered separately, later. Now the deploy's first log line says so.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const required = ["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "ANTHROPIC_API_KEY"]
  const missing = required.filter(k => !process.env[k]?.trim())
  if (missing.length === 0) return
  const msg = `[startup] missing required environment variables: ${missing.join(", ")} — see .env.example`
  // Production runs without them are broken; local dev may legitimately lack CRON_SECRET.
  if (process.env.NODE_ENV === "production") console.error(msg)
  else console.warn(msg)
}
