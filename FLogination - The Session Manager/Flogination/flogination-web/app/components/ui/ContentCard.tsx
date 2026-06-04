'use client'

import React from 'react'

interface ContentCardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
}

const PADDING_MAP = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
} as const

/**
 * Standard white card container with border, rounded corners, and shadow.
 * The primary grouping unit for page content in the Flogination UI.
 */
export function ContentCard({ children, className, hover = false, padding = 'md', onClick }: ContentCardProps) {
  const paddingClass = PADDING_MAP[padding]
  const hoverClass = hover
    ? 'transition-all duration-200 hover:shadow-[0_4px_16px_rgba(83,65,205,0.08)] hover:border-primary/20 cursor-pointer'
    : 'transition-shadow duration-200'

  return (
    <div
      onClick={onClick}
      className={`bg-surface-container-lowest border border-outline-variant rounded-card shadow-card ${paddingClass} ${hoverClass} ${className ?? ''}`}
    >
      {children}
    </div>
  )
}
