import { signIn } from "@/auth"
import { Button } from "@/components/ui/button"
import { Activity } from "lucide-react"

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background overflow-hidden relative">
      {/* Decorative background orbs */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-500/12 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-blue-500/6 rounded-full blur-[80px] pointer-events-none" />

      {/* Card */}
      <div className="relative w-full max-w-sm mx-4">
        <div
          className="rounded-2xl border border-white/8 p-8 space-y-8"
          style={{
            background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(16,15,26,0.95) 50%)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.1)",
          }}
        >
          {/* Branding */}
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="relative">
                <div className="absolute inset-0 bg-indigo-500/60 rounded-xl blur-lg" />
                <div className="relative bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl p-2.5">
                  <Activity className="h-6 w-6 text-white" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-gradient">Emergenthealth</h1>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your personal health &amp; life dashboard
            </p>
          </div>

          {/* Sign-in form */}
          <form
            action={async () => {
              "use server"
              await signIn("google", { redirectTo: "/dashboard" })
            }}
          >
            <Button
              type="submit"
              className="w-full gap-2.5 h-11 text-sm font-semibold rounded-xl bg-white text-gray-900 hover:bg-gray-100 shadow-lg"
              size="lg"
            >
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
              Continue with Google
            </Button>
          </form>

          <p className="text-xs text-center text-muted-foreground/70 leading-relaxed">
            Connects to Google Calendar &amp; Gmail.
            <br />
            Health data synced via Oura.
          </p>
        </div>
      </div>
    </div>
  )
}
