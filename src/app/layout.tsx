import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import Link from "next/link"
import { ServiceWorkerRegistration } from "@/components/layout/ServiceWorkerRegistration"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "Emergenthealth — Your health, finally in one place",
    template: "%s | Emergenthealth",
  },
  description: "Connect your wearables, apps, and habits. Oura Ring, YNAB, Strava, GitHub and more — all in one beautiful dashboard.",
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    siteName: "Emergenthealth",
    title: "Emergenthealth — Your health, finally in one place",
    description: "Connect your wearables, apps, and habits. See patterns you'd never notice alone.",
    url: "https://emergenthealth.vercel.app",
  },
  twitter: {
    card: "summary_large_image",
    title: "Emergenthealth — Your health, finally in one place",
    description: "Connect your wearables, apps, and habits. See patterns you'd never notice alone.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Emergenthealth",
  },
  keywords: ["health dashboard", "oura ring", "habit tracking", "health analytics", "YNAB", "strava", "sleep tracking"],
  other: {
    "mobile-web-app-capable": "yes",
  },
}

export const viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Apply saved accent + base theme before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const a=localStorage.getItem('accent');if(a&&a!=='indigo')document.documentElement.setAttribute('data-accent',a);const t=localStorage.getItem('base_theme');if(t&&t!=='midnight')document.documentElement.setAttribute('data-theme',t)}catch(e){}`,
          }}
        />
      </head>
      <body className="h-full antialiased bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
        <ServiceWorkerRegistration />
        <footer className="fixed bottom-0 right-0 z-50 p-3 flex gap-3 pointer-events-none">
          <Link href="/privacy" className="pointer-events-auto text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Privacy</Link>
          <Link href="/terms" className="pointer-events-auto text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Terms</Link>
        </footer>
      </body>
    </html>
  )
}
