// What to say when a request didn't work, without claiming to know why.
//
// Eleven handlers across six screens were written as
//
//   } catch { setError("Network error") }
//
// — the error object thrown away unread, and a cause asserted anyway. Often
// the wrong one. In the Strava and Oura sync handlers `await res.json()` sits
// INSIDE the try, so a 500 that returns an HTML crash page makes the parse
// throw, lands here, and tells the user to check their connection. The
// connection was fine. The server fell over, and the one person who could
// report that was sent to look at their wifi.
//
// The thrown value does carry the answer, and the distinctions are exact:
// `fetch` rejects with a TypeError only when the request never completed at
// the network layer, and `res.json()` throws a SyntaxError only when a
// response did arrive and was not JSON. So: say which of those happened, and
// where neither is known, say that instead of inventing one.

/** True when the browser is sure it has no connection; false covers "don't know". */
function knownOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

/**
 * An honest one-liner for a failed request, ending in what to do next.
 *
 * `offline` is injectable so this is testable without a browser; leave it
 * alone in app code.
 */
export function describeFetchFailure(error: unknown, offline = knownOffline()): string {
  if (offline) {
    return "You're offline — this needs a connection."
  }
  if (error instanceof TypeError) {
    // fetch itself rejected: DNS, TLS, a dropped connection, a blocked
    // request. The one case where "network" is the honest word.
    return "Couldn't reach the server. Check your connection and try again."
  }
  if (error instanceof SyntaxError) {
    // A response came back and wasn't JSON — almost always a crash page.
    return "The server sent back something unreadable — it probably errored. Try again in a minute."
  }
  return "That didn't go through. Try again in a minute."
}
