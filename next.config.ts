import type { NextConfig } from "next"

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
]

// Extra origins for Server Actions — add your Tailscale hostname here:
// ALLOWED_ORIGINS=lenovo.your-tailnet.ts.net:3000
const extraOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)

const nextConfig: NextConfig = {
  // Standalone output for self-hosted Docker deployment
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/mcp/oauth-metadata",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/mcp/protected-resource",
      },
    ]
  },
  typescript: {
    ignoreBuildErrors: true, // TODO: resolve remaining type errors and set to false
  },
  serverExternalPackages: ["@actual-app/api", "@actual-app/core"],
  turbopack: {},
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "emergenthealth.vercel.app", ...extraOrigins],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
}

export default nextConfig
