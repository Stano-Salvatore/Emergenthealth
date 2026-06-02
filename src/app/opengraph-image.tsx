import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "Emergenthealth — Your health, finally in one place"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#09090f",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: "absolute",
            top: -200,
            left: -200,
            width: 700,
            height: 700,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -100,
            right: -100,
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 70%)",
          }}
        />

        {/* Logo + name */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px", marginBottom: "32px" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "18px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "32px",
            }}
          >
            ◉
          </div>
          <span style={{ fontSize: "44px", fontWeight: 800, color: "#f2f2fa", letterSpacing: "-1px" }}>
            Emergenthealth
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: "52px",
            fontWeight: 800,
            color: "#ffffff",
            textAlign: "center",
            lineHeight: 1.15,
            marginBottom: "24px",
            letterSpacing: "-1.5px",
          }}
        >
          Your health, finally
          <br />
          <span style={{ color: "#818cf8" }}>in one place.</span>
        </div>

        {/* Sub */}
        <div
          style={{
            fontSize: "24px",
            color: "#94a3b8",
            textAlign: "center",
            maxWidth: 760,
            lineHeight: 1.5,
            marginBottom: "48px",
          }}
        >
          Oura Ring · YNAB · Strava · GitHub · Google Calendar — all connected, all beautiful.
        </div>

        {/* Integration pills */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
          {["💍 Sleep & HRV", "🏃 Activities", "💰 Finances", "🤖 AI Insights", "🎯 Habits"].map(label => (
            <div
              key={label}
              style={{
                padding: "8px 20px",
                borderRadius: "100px",
                border: "1px solid rgba(99,102,241,0.3)",
                background: "rgba(99,102,241,0.08)",
                color: "#c7d2fe",
                fontSize: "18px",
                fontWeight: 500,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* URL badge */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            right: 60,
            fontSize: "18px",
            color: "rgba(148,163,184,0.5)",
            fontWeight: 500,
          }}
        >
          emergenthealth.app
        </div>
      </div>
    ),
    { ...size }
  )
}
