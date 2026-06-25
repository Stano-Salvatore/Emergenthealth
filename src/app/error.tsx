"use client"

import { useEffect } from "react"
import Link from "next/link"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html>
      <body className="min-h-screen flex items-center justify-center bg-[#09090f] text-white">
        <div className="text-center max-w-sm mx-4 space-y-6 p-8">
          <div className="text-6xl font-black text-[#4f46e5]/20 leading-none">500</div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-sm text-gray-400">
              An unexpected error occurred. Your data is safe.
            </p>
            {error.digest && (
              <p className="text-xs text-gray-600 font-mono">Error ID: {error.digest}</p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={reset}
              className="w-full rounded-xl bg-[#4f46e5] py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Try again →
            </button>
            <Link
              href="/dashboard"
              className="block w-full rounded-xl border border-gray-700 py-3 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </body>
    </html>
  )
}
