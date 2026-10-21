import { type HTMLAttributes } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement>

export default function Card({ className = '', children, ...props }: CardProps) {
  return (
    <div className={`bg-card rounded-card border border-border ${className}`} {...props}>
      {children}
    </div>
  )
}
