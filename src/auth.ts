import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { isAuthKey, MOBILE_AUTH_COOKIE } from "@/lib/session-code"
import type { NextAuthConfig } from "next-auth"

// Redirect callback helper: if THIS browser started a mobile sign-in, force
// Chrome to /api/mobile-auth-bridge so it can read its own session cookie and
// store it for the WebView to redeem. This is the fallback when Auth.js v5 beta
// ignores the callbackUrl set in mobile-auth-start (skipCSRFCheck suppresses
// the cookie).
//
// "This browser" is the whole point. The earlier version looked up ANY pending
// marker, newest first — so anyone could plant a marker through the public
// start route, wait for any account to sign in, and collect that account's
// session through the poll + set-cookie pair. The marker is now bound to the
// browser that created it by a cookie mobile-auth-start sets, and only a
// marker matching that cookie is honoured.
async function checkMobilePendingRedirect(baseUrl: string): Promise<string | null> {
  let authKey: string | undefined
  try {
    authKey = (await cookies()).get(MOBILE_AUTH_COOKIE)?.value
  } catch {
    return null // not inside a request scope — nothing pending
  }
  if (!isAuthKey(authKey)) return null

  const identifier = `mobile-auth-pending:${authKey}`
  const pending = await prisma.verificationToken.findFirst({
    where: { identifier, expires: { gt: new Date() } },
    select: { identifier: true },
  })
  if (!pending) return null
  await prisma.verificationToken.deleteMany({ where: { identifier } })
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
      // state + PKCE stay ON (the Auth.js default). They were once disabled
      // for a cookie-jar split between the WebView and a Custom Tab, but the
      // current mobile flow starts AND finishes inside the same Custom Tab
      // (/mobile-signin → /api/mobile-auth-start → Google → callback → bridge),
      // so the check cookies live where the callback reads them. Without the
      // checks, a login-CSRF could sign a victim into an attacker's account.
      authorization: {
        params: {
          // Only ask for what this release actually uses. Gmail and smart home
          // are held back (see lib/features.ts), so requesting their scopes at
          // sign-in put "read your email" and "control your devices" on the
          // consent screen of a health app for features nobody can reach —
          // alarming to the user, and needless verification burden on the
          // OAuth app. Add each back alongside the release that turns it on.
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
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
