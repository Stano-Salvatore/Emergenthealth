import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { cookies } from "next/headers"
import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import Link from "next/link"
import { ServiceWorkerRegistration } from "@/components/layout/ServiceWorkerRegistration"
import { DeviceWidthCapture } from "@/components/layout/DeviceWidthCapture"
import { Analytics } from "@vercel/analytics/next"

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
    url: "https://emergenthealth.app",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Emergenthealth — Your health, finally in one place",
    description: "Connect your wearables, apps, and habits. See patterns you'd never notice alone.",
    images: ["/opengraph-image"],
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

// Rendered server-side from a cookie so the viewport <meta> is CORRECT in the
// very first bytes of HTML. Android WebView computes its zoom-to-fit
// ("initial-scale") once, from whatever viewport meta is present at first
// paint — a client-side mutation afterward can widen the layout (CSS
// breakpoints pick it up) but can't retroactively change the scale already
// locked in. See src/lib/display-scale.ts for the full story.
export async function generateViewport(): Promise<Viewport> {
  const store = await cookies()
  const rawZoom = store.get("display_zoom")?.value
  const scale = rawZoom ? parseFloat(rawZoom) : 1
  const zoom = !scale || Number.isNaN(scale) || scale <= 0 ? 1 : scale

  if (zoom > 0.999 && zoom < 1.001) {
    return { themeColor: "#4f46e5", width: "device-width", initialScale: 1, viewportFit: "cover" }
  }

  const rawWidth = store.get("device_width_css")?.value
  const deviceWidth = rawWidth ? parseInt(rawWidth, 10) : 400
  const width = Math.round((Number.isNaN(deviceWidth) || deviceWidth <= 0 ? 400 : deviceWidth) / zoom)

  return { themeColor: "#4f46e5", width, initialScale: zoom, viewportFit: "cover" }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Apply saved accent + base theme before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const a=localStorage.getItem('accent');if(a&&a!=='indigo')document.documentElement.setAttribute('data-accent',a);const t=localStorage.getItem('base_theme');if(t&&t!=='midnight')document.documentElement.setAttribute('data-theme',t);}catch(e){}`,
          }}
        />
      </head>
      <body className="h-full antialiased bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
        <ServiceWorkerRegistration />
        <DeviceWidthCapture />
        <Analytics />
        <footer className="fixed bottom-0 right-0 z-50 p-3 flex gap-3 pointer-events-none">
          <Link href="/privacy" className="pointer-events-auto text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Privacy</Link>
          <Link href="/terms" className="pointer-events-auto text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Terms</Link>
        </footer>
      </body>
    </html>
  )
}
