"use client"

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ background: "#09090f", color: "#fafafa", fontFamily: "system-ui, sans-serif" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            textAlign: "center",
            gap: "1.5rem",
          }}
        >
          <div style={{ fontSize: "3rem" }}>⚠️</div>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Something went wrong
            </h1>
            <p style={{ color: "#a1a1aa", fontSize: "0.875rem", maxWidth: "28rem" }}>
              An unexpected error occurred. This has been logged. Please try refreshing the page.
            </p>
            {error.digest && (
              <p style={{ color: "#71717a", fontSize: "0.75rem", marginTop: "0.5rem", fontFamily: "monospace" }}>
                Error ID: {error.digest}
              </p>
            )}
          </div>
          <button
            onClick={() => reset()}
            style={{
              background: "color-mix(in srgb, #6366f1 15%, transparent)",
              border: "1px solid color-mix(in srgb, #6366f1 30%, transparent)",
              color: "#a5b4fc",
              borderRadius: "0.75rem",
              padding: "0.5rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
