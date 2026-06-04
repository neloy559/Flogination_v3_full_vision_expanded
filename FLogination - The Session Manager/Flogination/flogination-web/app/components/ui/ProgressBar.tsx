'use client'

/**
 * Returns the Tailwind background color class for a progress bar fill
 * based on percentage thresholds.
 *
 * @param pct - Percentage value (0–100)
 * @returns Tailwind bg class: green < 65, orange 65–84, red ≥ 85
 *
 * @example
 * getBarColor(50)  // → 'bg-[#00b894]'
 * getBarColor(70)  // → 'bg-[#fdcb6e]'
 * getBarColor(90)  // → 'bg-[#e17055]'
 */
export function getBarColor(pct: number): string {
  if (pct < 65) return 'bg-[#00b894]'
  if (pct <= 84) return 'bg-[#fdcb6e]'
  return 'bg-[#e17055]'
}

interface ProgressBarProps {
  value: number       // 0–100
  className?: string  // optional width override
}

/**
 * Threshold-colored progress bar component.
 * Green below 65%, orange 65–84%, red 85%+.
 *
 * @param value - Percentage value (0–100)
 * @param className - Optional additional classes (e.g. width override)
 *
 * @example
 * <ProgressBar value={72} />
 * <ProgressBar value={45} className="w-32" />
 */
export function ProgressBar({ value, className }: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value))
  return (
    <div className={`h-2 rounded-[3px] bg-surface-container overflow-hidden ${className ?? ''}`}>
      <div
        className={`h-full rounded-[3px] transition-all duration-300 ${getBarColor(clampedValue)}`}
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  )
}
