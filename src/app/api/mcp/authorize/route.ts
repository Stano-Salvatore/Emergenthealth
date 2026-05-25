import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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

const ALLOWED_REDIRECT_HOSTS = ["claude.ai", "localhost"]
function isAllowedRedirect(uri: string): boolean {
  try {
    const host = new URL(uri).hostname
    return ALLOWED_REDIRECT_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
  } catch { return false }
}

// OAuth 2.0 Authorization Endpoint for Claude.ai mobile.
// If the user has a NextAuth session with an MCP key, redirect immediately.
// Otherwise show a simple form so they can paste their API key directly —
// no NextAuth sign-in required for the MCP OAuth flow.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const redirectUri = searchParams.get("redirect_uri") ?? ""
  const state = searchParams.get("state") ?? ""
  const codeChallenge = searchParams.get("code_challenge") ?? ""
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? ""

  if (!redirectUri || !isAllowedRedirect(redirectUri)) {
    return Response.json({ error: "invalid_request", error_description: "redirect_uri is missing or not allowed" }, { status: 400 })
  }

  // Fast path: if the user is already signed in and has a key, skip the form
  const session = await auth()
  if (session?.user?.id) {
    const key = await prisma.mcpApiKey.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    }).catch(() => null)

    if (key) {
      const callback = new URL(redirectUri)
      if (state) callback.searchParams.set("state", state)
      callback.searchParams.set("code", key.token)
      return NextResponse.redirect(callback.toString())
    }
  }

  return keyForm(redirectUri, state, codeChallenge, codeChallengeMethod)
}

export async function POST(req: NextRequest) {
  const data = await req.formData()
  const redirectUri = (data.get("redirect_uri") as string) ?? ""
  const state = (data.get("state") as string) ?? ""
  const apiKey = ((data.get("api_key") as string) ?? "").trim()
  const codeChallenge = (data.get("code_challenge") as string) ?? ""
  const codeChallengeMethod = (data.get("code_challenge_method") as string) ?? ""

  if (!redirectUri || !isAllowedRedirect(redirectUri)) {
    return Response.json({ error: "invalid_request" }, { status: 400 })
  }

  if (!apiKey) {
    return keyForm(redirectUri, state, codeChallenge, codeChallengeMethod, "Please enter your MCP API key.")
  }

  const key = await prisma.mcpApiKey.findUnique({ where: { token: apiKey } }).catch(() => null)
  if (!key) {
    return keyForm(redirectUri, state, codeChallenge, codeChallengeMethod, "Invalid API key. Please check and try again.")
  }

  const callback = new URL(redirectUri)
  if (state) callback.searchParams.set("state", state)
  callback.searchParams.set("code", key.token)
  return NextResponse.redirect(callback.toString())
}
