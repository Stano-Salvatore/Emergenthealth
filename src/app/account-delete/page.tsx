import { auth } from "@/auth"
import Link from "next/link"
import type { Metadata } from "next"
import { DeleteAccountForm } from "./DeleteAccountForm"

export const metadata: Metadata = {
  title: "Delete Account — Emergenthealth",
  description: "Permanently delete your Emergenthealth account and all associated data.",
}

export default async function AccountDeletePage() {
  const session = await auth()

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
          <div>
            <div className="text-3xl mb-3">⚠️</div>
            <h1 className="text-2xl font-bold mb-2">Delete your account</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              This permanently deletes your account and all associated data — health logs, habits,
              mood entries, transactions, journal notes, and connected integrations. This cannot
              be undone.
            </p>
          </div>

          <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 space-y-2">
            <p className="text-sm font-medium text-red-400">What gets deleted:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {[
                "All health & sleep data",
                "Mood logs & journal entries",
                "Habits & completions",
                "Financial transactions",
                "Connected integrations & tokens",
                "Chat history",
                "Your account & login",
              ].map(item => (
                <li key={item} className="flex items-center gap-2">
                  <span className="text-red-500/60 text-xs">✕</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {session?.user ? (
            <DeleteAccountForm userEmail={session.user.email ?? ""} />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sign in first to delete your account.
              </p>
              <Link
                href="/signin"
                className="block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Sign in
              </Link>
            </div>
          )}

          <p className="text-xs text-center text-muted-foreground/60">
            Changed your mind?{" "}
            <Link href="/dashboard" className="hover:text-muted-foreground transition-colors underline">
              Go back to the app
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
