import Link from "next/link"
import { Button } from "@/components/ui/button"
import { auth } from "@/auth"

export default async function NotFound() {
  const session = await auth()
  const isLoggedIn = !!session?.user

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-primary/6 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative text-center max-w-sm mx-4 space-y-6">
        <div className="text-7xl font-black text-primary/20 leading-none">404</div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            This page doesn&apos;t exist. Maybe you followed an old link or mistyped the URL.
          </p>
        </div>
        <Button asChild>
          <Link href={isLoggedIn ? "/dashboard" : "/"}>
            {isLoggedIn ? "Back to dashboard →" : "Go home →"}
          </Link>
        </Button>
      </div>
    </div>
  )
}
