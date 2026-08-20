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

/**
 * Copy text to the clipboard, and say whether it worked.
 *
 * `navigator.clipboard` is undefined on an insecure origin and can reject
 * without one, and every caller here wrapped it in a bare catch — so a failed
 * copy looked exactly like a successful one: nothing happened, and the button
 * said nothing. The legacy execCommand path still works where the modern API
 * doesn't, and the boolean lets the caller tell the truth either way.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const el = document.createElement("textarea")
    el.value = text
    el.setAttribute("readonly", "")
    el.style.position = "fixed"
    el.style.opacity = "0"
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}
