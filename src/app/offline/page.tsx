export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground px-4">
      <svg width="64" height="32" viewBox="0 0 240 120" className="opacity-40">
        <polyline
          points="0,60 40,60 58,16 76,104 94,34 110,86 126,60 240,60"
          fill="none"
          stroke="currentColor"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-sm text-muted-foreground text-center max-w-xs">
        Emergenthealth needs a connection to load your data. Check your network and try again.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Retry
      </button>
    </div>
  )
}
