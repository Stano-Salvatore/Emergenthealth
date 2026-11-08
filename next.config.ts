import type { NextConfig } from "next"

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
]

/** The host of a self-hosted server (docs/self-hosting.md), when it is not Vercel. */
function selfHostedOrigin(): string[] {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").host
    return host && host !== "emergenthealth.vercel.app" ? [host] : []
  } catch {
    return []
  }
}

const nextConfig: NextConfig = {
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
    // Was true with a TODO. The last offender (a duplicate @auth/core copy)
    // is resolved, so builds now typecheck — a wrong column name or a bad
    // prop fails the deploy instead of shipping and failing silently at
    // runtime, which is exactly how the widget lost its weather for months.
    ignoreBuildErrors: false,
  },
  serverExternalPackages: ["@actual-app/api", "@actual-app/core"],
  turbopack: {},
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "emergenthealth.vercel.app", ...selfHostedOrigin()],
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
