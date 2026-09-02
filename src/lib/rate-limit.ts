// Simple sliding-window in-memory rate limiter
// Map<userId, { count: number; windowStart: number }>
// checkRateLimit(userId, limit, windowMs): { allowed: boolean; remaining: number; resetAt: number }

const limits = new Map<string, { count: number; windowStart: number }>()

export function checkRateLimit(
  userId: string,
  key: string,       // namespace like "chat" or "insight"
  limit: number,     // max requests
  windowMs: number   // window in ms
): { allowed: boolean; remaining: number; resetAt: number } {
  const mapKey = `${key}:${userId}`
  const now = Date.now()
  const entry = limits.get(mapKey)

  if (!entry || now - entry.windowStart > windowMs) {
    limits.set(mapKey, { count: 1, windowStart: now })
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + windowMs }
  }

  entry.count++
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.windowStart + windowMs }
}

/**
 * Best-effort client address for limits on routes that have no user yet
 * (sign-in, the mobile bridge). Behind Vercel the first x-forwarded-for hop is
 * the client; elsewhere it's whatever the platform put there, or "unknown" —
 * which still limits, just collectively.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim() || "unknown"
  return req.headers.get("x-real-ip") ?? "unknown"
}
