'use client'

import React, { useId } from 'react'

interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

/**
 * Custom CSS toggle switch component (40x20px).
 * Uses the .toggle-switch and .checked CSS classes defined in globals.css.
 * No JavaScript animation — pure CSS transition on the knob position.
 *
 * @param checked - Current toggle state
 * @param onChange - Callback called with the new boolean value on change
 * @param label - Optional text label displayed to the right of the toggle
 * @param disabled - When true, disables interaction and reduces opacity
 *
 * @example
 * <ToggleSwitch checked={enabled} onChange={setEnabled} label="Enable feature" />
 */
export function ToggleSwitch({ checked, onChange, label, disabled = false }: ToggleSwitchProps) {
  const id = useId()

  return (
    <label
      htmlFor={id}
      className={`inline-flex items-center gap-2 cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
        aria-checked={checked}
      />
      <span
        className={`toggle-switch${checked ? ' checked' : ''}`}
        aria-hidden="true"
      />
      {label && (
        <span className="text-body-md text-on-surface">{label}</span>
      )}
    </label>
  )
}
