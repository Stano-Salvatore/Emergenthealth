import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { issueMcpCode, pkceMethod } from "@/lib/mcp-oauth-code"
import { checkRateLimit, clientIp } from "@/lib/rate-limit"

export const runtime = "nodejs"

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function keyForm(redirectUri: string, state: string, codeChallenge: string, codeChallengeMethod: string, error?: string) {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect to EmergentHealth</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
    .card{background:#141414;border:1px solid #262626;border-radius:12px;padding:2rem;width:100%;max-width:420px}
    h1{font-size:1.25rem;font-weight:600;margin-bottom:.5rem}
    p{font-size:.875rem;color:#a3a3a3;margin-bottom:1.5rem;line-height:1.5}
    label{display:block;font-size:.75rem;font-weight:500;color:#a3a3a3;margin-bottom:.375rem;text-transform:uppercase;letter-spacing:.05em}
    input[type=text]{width:100%;background:#0a0a0a;border:1px solid #262626;border-radius:8px;color:#e5e5e5;font-size:.875rem;padding:.625rem .75rem;margin-bottom:1rem;outline:none;font-family:monospace}
    input[type=text]:focus{border-color:#525252}
    button{width:100%;background:#e5e5e5;color:#0a0a0a;border:none;border-radius:8px;font-size:.875rem;font-weight:600;padding:.75rem;cursor:pointer}
    button:hover{background:#d4d4d4}
    .error{background:#450a0a;border:1px solid #7f1d1d;border-radius:8px;color:#fca5a5;font-size:.875rem;padding:.75rem;margin-bottom:1rem}
    .hint{font-size:.75rem;color:#525252;margin-top:1rem;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect Claude to EmergentHealth</h1>
    <p>Enter your MCP API key to give Claude access to your health data.</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ""}
    <form method="POST" action="/api/mcp/authorize">
      <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}">
      <input type="hidden" name="state" value="${esc(state)}">
      <input type="hidden" name="code_challenge" value="${esc(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${esc(codeChallengeMethod)}">
      <label for="api_key">MCP API Key</label>
      <input type="text" id="api_key" name="api_key" placeholder="mcp_fit_..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <button type="submit">Connect</button>
    </form>
    <p class="hint">Find your API key at <strong>emergenthealth.vercel.app → Settings → MCP API Keys</strong>. Generate one if you haven't already.</p>
  </div>
</body>
</html>`,
    { headers: { "Content-Type": "text/html" } },
  )
}

interface FlowParams { redirectUri: string; state: string; codeChallenge: string; codeChallengeMethod: string }

function hidden(p: FlowParams) {
  return `<input type="hidden" name="redirect_uri" value="${esc(p.redirectUri)}">
      <input type="hidden" name="state" value="${esc(p.state)}">
      <input type="hidden" name="code_challenge" value="${esc(p.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${esc(p.codeChallengeMethod)}">`
}

// Asked of a signed-in user before a code is issued. The answer comes back as
// a POST, which the session cookie (SameSite=Lax) only rides when the user
// submits it here — so another site can start this flow but can't answer it.
function consentPage(p: FlowParams, email: string | null | undefined) {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect to EmergentHealth</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
    .card{background:#141414;border:1px solid #262626;border-radius:12px;padding:2rem;width:100%;max-width:420px}
    h1{font-size:1.25rem;font-weight:600;margin-bottom:.5rem}
    p{font-size:.875rem;color:#a3a3a3;margin-bottom:1.5rem;line-height:1.5}
    button{width:100%;background:#e5e5e5;color:#0a0a0a;border:none;border-radius:8px;font-size:.875rem;font-weight:600;padding:.75rem;cursor:pointer}
    button:hover{background:#d4d4d4}
    .hint{font-size:.75rem;color:#525252;margin-top:1rem;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect Claude to EmergentHealth?</h1>
    <p>Claude will be able to read and log your health data${email ? ` as <strong>${esc(email)}</strong>` : ""}. You can revoke it any time by deleting the key in Settings → MCP API Keys.</p>
    <form method="POST" action="/api/mcp/authorize">
      ${hidden(p)}
      <button type="submit" name="action" value="allow">Allow</button>
    </form>
    <p class="hint">Didn't start this from Claude? Just close this page.</p>
  </div>
</body>
</html>`,
    { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } },
  )
}

const ALLOWED_REDIRECT_HOSTS = ["claude.ai", "localhost"]
function isAllowedRedirect(uri: string): boolean {
  try {
    const host = new URL(uri).hostname
    return ALLOWED_REDIRECT_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
  } catch { return false }
}

async function redirectWithCode(p: FlowParams, keyId: string) {
  const code = await issueMcpCode({
    keyId,
    redirectUri: p.redirectUri,
    challenge: p.codeChallenge,
    method: pkceMethod(p.codeChallengeMethod) ?? "",
  })
  const callback = new URL(p.redirectUri)
  if (p.state) callback.searchParams.set("state", p.state)
  callback.searchParams.set("code", code)
  return NextResponse.redirect(callback.toString())
}

function invalid(description: string) {
  return Response.json({ error: "invalid_request", error_description: description }, { status: 400 })
}

// OAuth 2.0 Authorization Endpoint for Claude.ai.
// A signed-in user with a key is asked to allow the connection; anyone else
// pastes their key. Either way the redirect carries a one-time code, never
// the key (see lib/mcp-oauth-code).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const p: FlowParams = {
    redirectUri: searchParams.get("redirect_uri") ?? "",
    state: searchParams.get("state") ?? "",
    codeChallenge: searchParams.get("code_challenge") ?? "",
    codeChallengeMethod: searchParams.get("code_challenge_method") ?? "",
  }

  if (!p.redirectUri || !isAllowedRedirect(p.redirectUri)) return invalid("redirect_uri is missing or not allowed")
  if (pkceMethod(p.codeChallengeMethod) === null) return invalid("code_challenge_method must be S256 or plain")

  const session = await auth()
  if (session?.user?.id) {
    const key = await prisma.mcpApiKey.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    }).catch(() => null)
    if (key) return consentPage(p, session.user.email)
  }

  return keyForm(p.redirectUri, p.state, p.codeChallenge, p.codeChallengeMethod)
}

export async function POST(req: NextRequest) {
  const data = await req.formData().catch(() => null)
  if (!data) return invalid("expected a form")
  const field = (k: string) => { const v = data.get(k); return typeof v === "string" ? v : "" }
  const p: FlowParams = {
    redirectUri: field("redirect_uri"),
    state: field("state"),
    codeChallenge: field("code_challenge"),
    codeChallengeMethod: field("code_challenge_method"),
  }

  if (!p.redirectUri || !isAllowedRedirect(p.redirectUri)) return invalid("redirect_uri is missing or not allowed")
  if (pkceMethod(p.codeChallengeMethod) === null) return invalid("code_challenge_method must be S256 or plain")

  if (field("action") === "allow") {
    const session = await auth()
    const key = session?.user?.id
      ? await prisma.mcpApiKey.findFirst({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" } }).catch(() => null)
      : null
    if (key) return redirectWithCode(p, key.id)
    return keyForm(p.redirectUri, p.state, p.codeChallenge, p.codeChallengeMethod)
  }

  const apiKey = field("api_key").trim()
  // The form checks secrets for anyone who asks: cap guesses per address, as the token endpoint does.
  if (!checkRateLimit(clientIp(req), "mcp_authorize", 30, 10 * 60 * 1000).allowed) {
    return keyForm(p.redirectUri, p.state, p.codeChallenge, p.codeChallengeMethod, "Too many attempts. Try again later.")
  }
  if (!apiKey) {
    return keyForm(p.redirectUri, p.state, p.codeChallenge, p.codeChallengeMethod, "Please enter your MCP API key.")
  }

  const key = await prisma.mcpApiKey.findUnique({ where: { token: apiKey } }).catch(() => null)
  if (!key) {
    return keyForm(p.redirectUri, p.state, p.codeChallenge, p.codeChallengeMethod, "Invalid API key. Please check and try again.")
  }

  return redirectWithCode(p, key.id)
}
