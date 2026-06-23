import { signIn } from "@/auth"

// Initiates Google OAuth for the Capacitor app.
//
// CRITICAL: this endpoint must be opened in a Chrome Custom Tab (the native
// MainActivity intercepts navigations to /api/mobile-signin and launches a
// Custom Tab). Calling signIn() here sets NextAuth's state / PKCE /
// callback-url cookies on THIS response — i.e. in Chrome's cookie jar. The
// OAuth callback is then also processed in Chrome, so every cookie NextAuth
// needs is present and the flow succeeds.
//
// Previously the WebView ran signIn() itself (via a server action), which set
// those cookies in the WebView's cookie jar while Chrome handled the callback
// with an empty jar — so the callback-url was lost and the user bounced back
// to /signin. Starting the flow in Chrome keeps the whole flow in one jar.
//
// redirectTo points at /api/mobile-auth-bridge, which hands the resulting
// session token back to the app via the emergenthealth:// custom scheme.
export async function GET() {
  await signIn("google", { redirectTo: "/api/mobile-auth-bridge" })
}
