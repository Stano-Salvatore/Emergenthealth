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
  title: "Emergenthealth Dashboard",
  description: "Personal health, finances, and life dashboard",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Emergenthealth",
  },
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
