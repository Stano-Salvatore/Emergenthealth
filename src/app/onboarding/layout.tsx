// The wizard fills a phone screen edge to edge — on a 390px screen a card with
// its own border and padding left the example pattern under 300px to live in —
// and becomes a card from the small breakpoint up. Safe-area padding keeps it
// clear of the notch and the home indicator in a home-screen app.
//
// overflow-x-clip, not overflow-hidden: hidden makes this a scroll container,
// and the wizard's buttons are position: sticky against the page's scroll.

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background relative overflow-x-clip">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, color-mix(in srgb, var(--primary) 12%, transparent) 0%, transparent 70%)",
        }}
      />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:justify-center sm:px-4 sm:py-12">
        {children}
      </div>
    </div>
  )
}
