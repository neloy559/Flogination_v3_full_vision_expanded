'use client'

import React from 'react'

type LogLevel = 'success' | 'info' | 'error'

interface LogEntry {
  id: string
  level: LogLevel
  message: string
  timestamp: number
}

interface LogPanelProps {
  entries: LogEntry[]
  maxHeight?: string
}

/**
 * Returns the Tailwind text color class for a log level.
 *
 * @param level - Log level: 'success', 'info', or 'error'
 * @returns Tailwind text class
 *
 * @example
 * getLogLevelColor('success') // 'text-secondary-container'
 * getLogLevelColor('info')    // 'text-primary-fixed'
 * getLogLevelColor('error')   // 'text-error'
 */
export function getLogLevelColor(level: LogLevel): string {
  switch (level) {
    case 'success': return 'text-secondary-container'
    case 'info':    return 'text-primary-fixed'
    case 'error':   return 'text-error'
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Dark terminal-style log panel with color-coded log level entries.
 * Uses JetBrains Mono font and inverse-surface background.
 *
 * @param entries - Array of log entries to display
 * @param maxHeight - Tailwind height class (default: 'h-64')
 *
 * @example
 * <LogPanel entries={logs} />
 * <LogPanel entries={logs} maxHeight="h-96" />
 */
export function LogPanel({ entries, maxHeight = 'h-64' }: LogPanelProps) {
  return (
    <div className={`bg-inverse-surface rounded-card p-3 ${maxHeight} overflow-y-auto font-mono text-[12px]`}>
      {entries.length === 0 ? (
        <p className="text-primary-fixed opacity-40 text-center py-4">No log entries</p>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <div key={entry.id} className={`flex items-start gap-2 ${getLogLevelColor(entry.level)}`}>
              <span className="opacity-50 shrink-0">{formatTimestamp(entry.timestamp)}</span>
              {entry.level === 'info' && (
                <span className="inline-block animate-spin shrink-0" aria-hidden="true">↻</span>
              )}
              <span className="break-all">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
