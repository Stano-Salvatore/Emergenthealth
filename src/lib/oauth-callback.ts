// OAuth `state` proves we issued the link, not that whoever approved it owns
// the account named inside: a link started on one account and approved by
// someone else would save the approver's tokens to the first account. So the
// callback also consults the browser's own session. It cannot simply require
// one: the Android app finishes OAuth in the system browser, which often has
// no session at all. Then the person is shown which account the connection
// will land on, and the code is exchanged only once they confirm.

export type CallbackDecision = "exchange" | "mismatch" | "confirm"

export function callbackDecision(sessionUserId: string | null | undefined, stateUserId: string): CallbackDecision {
  if (!sessionUserId) return "confirm"
  return sessionUserId === stateUserId ? "exchange" : "mismatch"
}

/** Set by a connect started from the onboarding wizard, so it comes back there. */
export const OAUTH_RETURN_COOKIE = "oauth_return"

/** Where a finished connect lands: the wizard's connect step, or Settings. Only "onboarding" is honoured. */
export function oauthReturnPath(cookieValue: string | undefined, query: string): string {
  return cookieValue === "onboarding" ? `/onboarding?step=connect&${query}` : `/dashboard/settings?${query}`
}

export function maskEmail(email: string | null | undefined): string {
  const at = email?.lastIndexOf("@") ?? -1
  if (!email || at < 1) return "an account with no email address"
  const local = email.slice(0, at)
  return `${local.slice(0, local.length > 2 ? 2 : 1)}•••${email.slice(at)}`
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export function confirmConnectPage(opts: { provider: string; account: string; action: string; code: string; state: string }): string {
  const provider = esc(opts.provider)
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect ${provider}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:16px;background:#0f0e1a;color:#fff;
      font-family:-apple-system,sans-serif;padding:24px;text-align:center}
    h1{font-size:20px;font-weight:700}
    p{color:#aaa;font-size:15px;max-width:320px;line-height:1.6}
    strong{color:#fff}
    button{background:#6c63ff;color:#fff;border:0;border-radius:14px;
      padding:16px 32px;font-size:16px;font-weight:700;min-width:240px}
  </style>
</head>
<body>
  <h1>Connect ${provider}?</h1>
  <p>Your ${provider} data will sync to the Emergenthealth account <strong>${esc(opts.account)}</strong>.</p>
  <p>If that is not your account, close this page. Nothing has been connected yet.</p>
  <form method="post" action="${esc(opts.action)}">
    <input type="hidden" name="code" value="${esc(opts.code)}" />
    <input type="hidden" name="state" value="${esc(opts.state)}" />
    <button type="submit">Connect</button>
  </form>
</body>
</html>`
}
