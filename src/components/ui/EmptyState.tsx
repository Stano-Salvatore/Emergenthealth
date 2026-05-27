import Link from "next/link"

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description: string
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 px-8 py-16 text-center">
      <div className="mb-4 text-muted-foreground/30">{icon}</div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">{description}</p>
      {action && (
        <div className="mt-5">
          {action.href ? (
            <Link
              href={action.href}
              className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {action.label}
            </Link>
          ) : (
            <button
              onClick={action.onClick}
              className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
