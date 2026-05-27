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
