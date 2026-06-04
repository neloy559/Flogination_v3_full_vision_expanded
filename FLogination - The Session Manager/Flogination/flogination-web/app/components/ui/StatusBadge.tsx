'use client';

import React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

/** All valid status values across the Flogination application. */
export type StatusValue =
  | 'live'
  | 'active'
  | 'checkpoint'
  | 'restricted'
  | 'dead'
  | 'draft'
  | 'paused'
  | 'running'
  | 'creating'
  | 'transferring'
  | 'complete'
  | 'failed'
  | 'verifying'
  | 'idle';

/** Props for the StatusBadge component. */
export interface StatusBadgeProps {
  /** The status value to display. Determines color and prefix icon. */
  status: StatusValue;
  /**
   * Visual size of the badge.
   * - `'sm'` — 11px text, 8px/2px padding
   * - `'md'` — label-sm text (12px), 10px/3px padding (default)
   */
  size?: 'sm' | 'md';
}

// ─── Style map ────────────────────────────────────────────────────────────────

/**
 * The resolved style descriptor for a status badge.
 * `bg` and `text` are CSS color values (hex or Tailwind class fragment).
 * `prefix` is the leading character/icon rendered before the label text.
 */
export interface StatusBadgeStyle {
  /** CSS background-color value (hex with opacity suffix) or a Tailwind bg class. */
  bg: string;
  /** CSS color value (hex) or a Tailwind text class. */
  text: string;
  /**
   * Prefix indicator rendered before the label.
   * - `'dot'`  — a static `●` colored dot
   * - `'pause'` — a `⏸` pause symbol
   * - `'spin'`  — an animated `↻` spinner
   */
  prefix: 'dot' | 'pause' | 'spin';
  /**
   * Whether the bg/text values are raw CSS hex strings (`true`) or
   * Tailwind utility class fragments (`false`).
   * When `true`, the component applies them via `style` prop.
   * When `false`, the component applies them as className strings.
   */
  useInlineStyle: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Green — Live / Active / Complete */
const GREEN_BG = '#00b89415';
const GREEN_TEXT = '#00b894';

/** Orange — Checkpoint */
const ORANGE_HEX_BG = '#fdcb6e15';
const ORANGE_HEX_TEXT = '#fdcb6e';

/** Red — Restricted / Failed */
const RED_BG = '#e1705515';
const RED_TEXT = '#e17055';

/** Gray — Dead / Draft / Idle */
const GRAY_BG = '#63636e15';
const GRAY_TEXT = '#636e72';

/** Purple — Running / Creating / Transferring / Verifying */
const PURPLE_BG = '#5341cd15';
const PURPLE_TEXT = '#5341cd';

// ─── Pure mapping function ────────────────────────────────────────────────────

/**
 * Returns the visual style descriptor for a given status value.
 * This is the single source of truth for all badge colors across the app.
 *
 * @param status - One of the 14 valid status values
 * @returns A `StatusBadgeStyle` object with `bg`, `text`, `prefix`, and `useInlineStyle`
 *
 * @example
 * getStatusBadgeStyle('live')
 * // → { bg: '#00b89415', text: '#00b894', prefix: 'dot', useInlineStyle: true }
 *
 * @example
 * getStatusBadgeStyle('paused')
 * // → { bg: 'bg-orange-100', text: 'text-orange-700', prefix: 'pause', useInlineStyle: false }
 *
 * @example
 * getStatusBadgeStyle('running')
 * // → { bg: '#5341cd15', text: '#5341cd', prefix: 'spin', useInlineStyle: true }
 */
export function getStatusBadgeStyle(status: StatusValue): StatusBadgeStyle {
  switch (status) {
    // ── Green ──────────────────────────────────────────────────────────────
    case 'live':
    case 'active':
    case 'complete':
      return { bg: GREEN_BG, text: GREEN_TEXT, prefix: 'dot', useInlineStyle: true };

    // ── Orange (hex) ───────────────────────────────────────────────────────
    case 'checkpoint':
      return { bg: ORANGE_HEX_BG, text: ORANGE_HEX_TEXT, prefix: 'dot', useInlineStyle: true };

    // ── Red ────────────────────────────────────────────────────────────────
    case 'restricted':
    case 'failed':
      return { bg: RED_BG, text: RED_TEXT, prefix: 'dot', useInlineStyle: true };

    // ── Gray ───────────────────────────────────────────────────────────────
    case 'dead':
    case 'draft':
    case 'idle':
      return { bg: GRAY_BG, text: GRAY_TEXT, prefix: 'dot', useInlineStyle: true };

    // ── Orange (Tailwind) — Paused ─────────────────────────────────────────
    case 'paused':
      return { bg: 'bg-orange-100', text: 'text-orange-700', prefix: 'pause', useInlineStyle: false };

    // ── Purple / Spinning ──────────────────────────────────────────────────
    case 'running':
    case 'creating':
    case 'transferring':
    case 'verifying':
      return { bg: PURPLE_BG, text: PURPLE_TEXT, prefix: 'spin', useInlineStyle: true };

    // TypeScript exhaustiveness guard — should never be reached at runtime
    default: {
      const _exhaustive: never = status;
      return { bg: GRAY_BG, text: GRAY_TEXT, prefix: 'dot', useInlineStyle: true };
    }
  }
}

// ─── Label helper ─────────────────────────────────────────────────────────────

/**
 * Capitalises the first letter of the status string for display.
 * e.g. `'live'` → `'Live'`, `'checkpoint'` → `'Checkpoint'`
 */
function formatLabel(status: StatusValue): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * A pill-shaped status badge that maps a status value to a color-coded label.
 *
 * Renders with `rounded-badge` (9999px) radius, a colored background, matching
 * text color, and a leading prefix indicator (dot, pause icon, or spinning arrow).
 *
 * Uses inline styles for hex-based colors (since Tailwind cannot purge arbitrary
 * hex values with opacity suffixes like `#00b89415` at build time).
 *
 * @param props.status - The status value to display (one of 14 valid values)
 * @param props.size   - `'sm'` for compact display, `'md'` for default (default: `'md'`)
 *
 * @example
 * // Default size
 * <StatusBadge status="live" />
 *
 * @example
 * // Small size in a table cell
 * <StatusBadge status="running" size="sm" />
 *
 * @example
 * // All statuses render correctly
 * <StatusBadge status="checkpoint" />
 * <StatusBadge status="paused" />
 * <StatusBadge status="failed" />
 */
export function StatusBadge({ status, size = 'md' }: StatusBadgeProps): React.ReactElement {
  const style = getStatusBadgeStyle(status);

  // Size-dependent classes
  const sizeClasses =
    size === 'sm'
      ? 'text-[11px] px-[8px] py-[2px]'
      : 'text-label-sm px-[10px] py-[3px]';

  // Base pill classes (always applied)
  const baseClasses = `inline-flex items-center gap-[5px] rounded-badge font-semibold whitespace-nowrap ${sizeClasses}`;

  // Build className and style prop depending on whether colors are hex or Tailwind
  const containerClassName = style.useInlineStyle
    ? baseClasses
    : `${baseClasses} ${style.bg} ${style.text}`;

  const containerStyle: React.CSSProperties = style.useInlineStyle
    ? { backgroundColor: style.bg, color: style.text }
    : {};

  // Prefix element
  const prefixElement = (() => {
    switch (style.prefix) {
      case 'dot':
        return <span aria-hidden="true">●</span>;
      case 'pause':
        return <span aria-hidden="true">⏸</span>;
      case 'spin':
        return (
          <span className="inline-block animate-spin" aria-hidden="true">
            ↻
          </span>
        );
    }
  })();

  return (
    <span className={containerClassName} style={containerStyle}>
      {prefixElement}
      {formatLabel(status)}
    </span>
  );
}
