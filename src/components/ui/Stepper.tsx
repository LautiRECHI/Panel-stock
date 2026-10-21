'use client'

import { Minus, Plus } from 'lucide-react'

interface StepperProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  id?: string
  label?: string
}

export default function Stepper({
  value,
  onChange,
  min = 0,
  max = Infinity,
  step = 1,
  disabled = false,
  id,
  label,
}: StepperProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <div className="inline-flex items-center border border-border rounded-input overflow-hidden bg-white">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={disabled || value <= min}
          aria-label="Disminuir"
          className="w-11 h-11 flex items-center justify-center text-muted hover:bg-surface hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>
        <input
          id={id}
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
          }}
          disabled={disabled}
          min={min}
          max={max === Infinity ? undefined : max}
          className="w-14 h-11 text-center text-sm font-medium text-foreground border-x border-border bg-white focus:outline-none focus:bg-surface [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          aria-live="polite"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={disabled || value >= max}
          aria-label="Aumentar"
          className="w-11 h-11 flex items-center justify-center text-muted hover:bg-surface hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
