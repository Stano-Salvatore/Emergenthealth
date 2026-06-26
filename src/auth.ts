import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import type { NextAuthConfig } from "next-auth"

// Redirect callback helper: if a mobile OAuth flow is pending, force Chrome to
// /api/mobile-auth-bridge so it can read its own session cookie and store it for
// the WebView to redeem. This is the fallback when Auth.js v5 beta ignores the
// callbackUrl set in mobile-auth-start (skipCSRFCheck suppresses the cookie).
async function checkMobilePendingRedirect(baseUrl: string): Promise<string | null> {
  const pending = await prisma.verificationToken.findFirst({
    where: {
      identifier: { startsWith: "mobile-auth-pending:" },
      expires: { gt: new Date() },
    },
    orderBy: { expires: "desc" },
  })
  if (!pending) return null
  const authKey = pending.identifier.replace("mobile-auth-pending:", "")
  await prisma.verificationToken.deleteMany({ where: { identifier: pending.identifier } })
  return `${baseUrl}/api/mobile-auth-bridge?auth_key=${encodeURIComponent(authKey)}`
}

// Exported so /api/mobile-auth-start can call Auth() directly with the same
// config. NextAuth mutates this object (setEnvDefaults adds secret + basePath)
// so by the time any route handler runs the config is fully initialised.
export const authConfig: NextAuthConfig = {
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      // State/PKCE cookies are set in WebView's cookie jar but the OAuth
      // callback is processed by Chrome Custom Tab (separate cookie jar).
      // Disable both so the callback isn't rejected for missing cookies.
      checks: [],
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/sdm.service",
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/gmail.readonly",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id
      return session
    },
    async redirect({ url, baseUrl }) {
      // After successful sign-in, redirect Chrome to the bridge if a mobile flow is pending.
      // Skips sign-in-page redirects (the user isn't authenticated yet in that case).
      const isSignInPage = url.includes("/signin")
      const isLocalUrl = url.startsWith("/") || url.startsWith(baseUrl)
      if (isLocalUrl && !isSignInPage) {
        const mobileRedirect = await checkMobilePendingRedirect(baseUrl)
        if (mobileRedirect) return mobileRedirect
      }
      if (url.startsWith("/")) return `${baseUrl}${url}`
      if (url.startsWith(baseUrl)) return url
      return baseUrl
    },
  },
  events: {
    async signIn({ account }) {
      if (account?.provider === "google" && account.access_token) {
        try {
          await prisma.account.update({
            where: {
              provider_providerAccountId: {
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
            },
            data: {
              access_token: account.access_token,
              // Only overwrite refresh_token if Google returned a new one
              ...(account.refresh_token != null && { refresh_token: account.refresh_token }),
              ...(account.expires_at != null && { expires_at: account.expires_at }),
              ...(account.scope != null && { scope: account.scope }),
              ...(account.id_token != null && { id_token: account.id_token }),
            },
          })
        } catch (e) {
          // PrismaAdapter may not have created the account yet on first sign-in — that's fine
          console.error("[auth] signIn token persist failed:", e)
        }
      }
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60,   // refresh once per day
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
