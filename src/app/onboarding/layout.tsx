export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      {/* Subtle radial gradient matching the app theme */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, color-mix(in srgb, var(--primary) 12%, transparent) 0%, transparent 70%)",
        }}
      />
      <div className="relative z-10 w-full flex items-center justify-center px-4 py-12">
        {children}
      </div>
    </div>
  )
}
