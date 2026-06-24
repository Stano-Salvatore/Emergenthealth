import { signIn } from "@/auth"
import { Button } from "@/components/ui/button"
import { Activity } from "lucide-react"
import { PasskeySignIn } from "./PasskeySignIn"
import { Suspense } from "react"
import { RefCapture } from "./RefCapture"
import { headers } from "next/headers"
import { CapacitorSignInButton } from "./CapacitorSignInButton"

const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked: "This email is already linked to a different sign-in method.",
  OAuthCallbackError: "Something went wrong during sign-in. Please try again.",
  OAuthSignin: "Could not start the sign-in flow. Please try again.",
  OAuthCreateAccount: "Could not create your account. Please try again.",
  Callback: "Sign-in callback failed. Please try again.",
  InvalidState: "Sign-in expired or was interrupted. Please try again.",
  Default: "An error occurred during sign-in. Please try again.",
}

const GoogleIcon = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
)

const GOOGLE_BTN_CLASS =
  "w-full gap-2.5 h-11 text-sm font-semibold rounded-xl bg-white text-gray-900 hover:bg-gray-100 shadow-lg"

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams
  const errorKey = sp.error ?? ""
  const errorMsg = ERROR_MESSAGES[errorKey] ?? (errorKey ? ERROR_MESSAGES.Default : null)

  // The Capacitor WebView appends this marker to its User-Agent (see
  // capacitor.config.ts). In the app the OAuth flow must START in a Chrome
  // Custom Tab (the native side intercepts /api/mobile-signin), so every
  // NextAuth cookie is set and read in the same (Chrome) cookie jar.
  const ua = (await headers()).get("user-agent") ?? ""
  const isCapacitor = ua.includes("Emergenthealth-Capacitor")
  const buttonLabel = errorMsg ? "Try again with Google" : "Continue with Google"

  return (
    <div className="min-h-screen flex items-center justify-center bg-background overflow-hidden relative">
      <Suspense><RefCapture /></Suspense>
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/12 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-blue-500/6 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative w-full max-w-sm mx-4">
        <div
          className="rounded-2xl border border-border/50 p-8 space-y-6"
          style={{
            background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 8%, transparent) 0%, rgba(16,15,26,0.95) 50%)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px color-mix(in srgb, var(--primary) 10%, transparent)",
          }}
        >
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/60 rounded-xl blur-lg" />
                <div className="relative bg-gradient-to-br from-primary to-primary/70 rounded-xl p-2.5">
                  <Activity className="h-6 w-6 text-white" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-gradient">Emergenthealth</h1>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your personal health &amp; life dashboard
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 text-center">
              {errorMsg}
            </div>
          )}

          <div className="space-y-3">
            {/* Passkey sign-in (shown if browser supports it) */}
            <PasskeySignIn />

            {/* Google sign-in */}
            {isCapacitor ? (
              // In the app: use window.location.href (full page navigation) so
              // Android's shouldOverrideUrlLoading sees /mobile-signin and opens
              // a Chrome Custom Tab. Next.js <a> tags use history.pushState which
              // is invisible to shouldOverrideUrlLoading, so Chrome Custom Tab
              // would never open and the OAuth flow would run inside the WebView.
              <CapacitorSignInButton label={buttonLabel} className={GOOGLE_BTN_CLASS} />
            ) : (
              <form
                action={async () => {
                  "use server"
                  await signIn("google", { redirectTo: "/dashboard" })
                }}
              >
                <Button type="submit" className={GOOGLE_BTN_CLASS} size="lg">
                  <GoogleIcon />
                  {buttonLabel}
                </Button>
              </form>
            )}
          </div>

          <p className="text-xs text-center text-muted-foreground/70 leading-relaxed">
            Connects to Google Calendar &amp; Gmail.
            <br />
            Health data synced via Oura.
          </p>
          <p className="text-[11px] text-center text-muted-foreground/50">
            By signing in you agree to our{" "}
            <a href="/terms" className="underline hover:text-muted-foreground transition-colors">Terms</a>
            {" "}and{" "}
            <a href="/privacy" className="underline hover:text-muted-foreground transition-colors">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  )
}
