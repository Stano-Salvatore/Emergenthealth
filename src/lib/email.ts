// The one sender for every transactional email.
//
// Resend's shared sandbox address (onboarding@resend.dev) delivers only to the
// Resend account's owner. Seven routes had it pasted in, so every other user's
// digest, review and export "sent" and then failed silently at the provider.
// Set EMAIL_FROM to a sender on a domain verified in Resend.
export const EMAIL_FROM = process.env.EMAIL_FROM?.trim() || "Emergenthealth <onboarding@resend.dev>"

/**
 * Whether a real sender has been configured for this deployment.
 *
 * False means EMAIL_FROM is unset and the line above fell back to Resend's
 * shared sandbox, which delivers **only** to the Resend account's owner.
 * Everyone else's mail is rejected at the provider with a 403.
 */
export const EMAIL_SENDER_CONFIGURED = Boolean(process.env.EMAIL_FROM?.trim())

/**
 * Why a send failed, in words the person who asked for it can act on.
 *
 * The same argument as `chat-error.ts`: "the mail service rejected the
 * message" is true of every cause and useful for none of them. The one this
 * deployment actually meets is an unset EMAIL_FROM, and that is knowable
 * without reading the provider's wording at all — so it is checked first,
 * rather than pattern-matching a 403 string that could change under us.
 */
export function describeMailFailure(error: unknown): string {
  if (!EMAIL_SENDER_CONFIGURED) {
    return "Email isn't set up for this deployment yet — the sender is still Resend's shared sandbox " +
      "address, which only delivers to the Resend account's own owner. Setting EMAIL_FROM to a sender " +
      "on a verified domain is the whole fix."
  }
  const msg = error instanceof Error ? error.message : String(error ?? "")
  if (/rate|too many|429/i.test(msg)) return "The mail service is rate-limiting us. Try again in a few minutes."
  if (/domain|verif/i.test(msg)) return "The sending domain isn't verified with the mail provider yet."
  if (/attach|size|too large|413/i.test(msg)) return "The message was too large for the mail service to carry."
  return "The mail service rejected the message."
}

/**
 * `someone@example.com` → `s***@example.com`, for logs that outlive the request.
 *
 * A fixed three stars, not one per character: a mask whose width is the name's
 * length still hands out the length, which for a short local part narrows it
 * considerably. The domain is kept deliberately — "is it everyone or just one
 * provider" is the first question anyone asks of a delivery problem.
 */
function maskAddress(to: string): string {
  const [name, domain] = to.split("@")
  if (!domain || !name) return "***"
  return `${name.slice(0, 1)}***@${domain}`
}

/**
 * Log a send that failed, for the paths nobody is watching.
 *
 * The crons used to `catch { /* non-fatal *\/ }` — which is true, a missed
 * digest breaks nothing — but it also meant a deployment whose email has
 * never worked for anyone looks identical to one where it works perfectly.
 * The comment at the top of this file describes exactly that going unnoticed.
 */
export function logMailFailure(where: string, to: string, error: unknown): void {
  console.error(`[email] ${where} to ${maskAddress(to)} failed: ${describeMailFailure(error)}`,
    error instanceof Error ? error.message : error)
}
