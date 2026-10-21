import { type ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4">
      {icon && (
        <div className="w-12 h-12 rounded-full bg-border flex items-center justify-center mb-4 text-muted">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-foreground mb-1">{title}</p>
      {description && (
        <p className="text-sm text-muted mb-6 max-w-xs">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  )
}
