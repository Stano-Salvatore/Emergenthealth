export { auth as middleware } from "@/auth"

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/sync/:path*",
    "/api/habits/:path*",
    "/api/reminders/:path*",
    "/api/chat/:path*",
  ],
}
