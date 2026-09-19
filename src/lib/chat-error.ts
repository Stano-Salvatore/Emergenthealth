// What Emergy says when the model call failed, without claiming to know why.
//
// The chat route was written as
//
//   } catch { controller.enqueue(… "Sorry, something went wrong." …) }
//
// — the thrown value discarded unread, exactly the pattern `fetch-error.ts`
// exists to correct on the client, still uncorrected on the one path where
// getting it wrong is most expensive. Every cause produced the same sentence:
// a key that was rotated, a rate limit, a model outage, and — the one that
// will actually happen — an API balance that ran out. The owner of the account
// is the only person who can fix any of them, and the app told them nothing.
//
// The distinctions are exact and the SDK hands them over as typed errors, so
// each one is named. What is NOT known is never asserted: an unrecognised
// failure says it is unrecognised, and the real error goes to the log either
// way, because the sentence a user reads is not a substitute for the line an
// owner needs.

import Anthropic from "@anthropic-ai/sdk"

/**
 * A spent balance is not its own error class — it arrives as a 400 whose
 * message names the credit. Matching the message is fragile by nature, so it
 * is only ever used to make an error MORE specific, never to swallow one:
 * every branch below has an honest answer without it.
 */
function mentionsCredit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /credit balance|insufficient (?:credit|funds)|out of credit|billing/i.test(message)
}

/**
 * One line for the chat bubble, in Emergy's voice, ending in the thing that
 * would actually fix it.
 */
export function describeChatFailure(error: unknown): string {
  if (mentionsCredit(error)) {
    return "I've run out of API credit, so I can't think right now — topping the account up brings me back. 🌱"
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return "My API key isn't being accepted any more. It may have been rotated or revoked."
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "My API key isn't allowed to do that. Worth checking what it's scoped to."
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "That was a lot of me at once — give it a minute and ask again."
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "The model service is having a moment. Nothing wrong on your end; try again shortly."
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "I couldn't reach the model service at all. Try again in a moment."
  }
  if (error instanceof Anthropic.BadRequestError) {
    // A 400 that is not about credit is the app's own fault — a malformed
    // request, an image too large, a context overrun. Saying "try again" would
    // send the user round a loop that cannot end.
    return "I sent that request wrong, so it was refused. That one's a bug on my side, not something you did."
  }
  return "Something went wrong on my side, and I don't know what — it's in the logs."
}

/**
 * The line for the runtime log. The user's sentence is deliberately short; an
 * owner debugging at 23:00 needs the status and the model's own words.
 */
export function logChatFailure(error: unknown): string {
  const status = error instanceof Anthropic.APIError ? error.status : undefined
  const message = error instanceof Error ? error.message : String(error ?? "")
  return JSON.stringify({
    kind: error?.constructor?.name ?? typeof error,
    status,
    message: message.slice(0, 400),
  })
}
