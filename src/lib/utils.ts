import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The message out of an unknown caught value.
 *
 * `catch (e: any)` and then `e.message` is how a thrown string or a rejected
 * object turns "sync failed: connection refused" into "sync failed: undefined"
 * — the very moment the message mattered. Catch clauses are `unknown`; this
 * narrows one honestly.
 */
export function errorMessage(e: unknown, fallback = "Unknown error"): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === "string" && e) return e
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === "string" && m) return m
  }
  return fallback
}
