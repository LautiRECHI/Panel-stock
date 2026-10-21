export type ChipStatus = 'success' | 'warning' | 'danger' | 'neutral'

interface StatusChipProps {
  status: ChipStatus
  label: string
}

const styles: Record<ChipStatus, string> = {
  success: 'bg-stock-ok-bg text-stock-ok',
  warning: 'bg-stock-low-bg text-stock-low',
  danger: 'bg-stock-none-bg text-stock-none',
  neutral: 'bg-border text-muted',
}

export default function StatusChip({ status, label }: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {label}
    </span>
  )
}
