import { useEntryAnimation } from '../lib/animationsPreference'

/**
 * Tiny animated horizontal bar fill used everywhere we render a
 * progress / volume / completeness bar in a list.
 *
 * Renders as a single coloured `<div>` that you place inside an
 * already-styled track (typically `h-X overflow-hidden rounded-full
 * bg-cribl-border/...`). The fill grows from 0% to its target width
 * once on mount.
 *
 * The component reads the global "animations enabled" preference
 * via `useEntryAnimation`, so it automatically renders at the final
 * width with no transition when animations are turned off in
 * Settings (or the OS reports `prefers-reduced-motion`).
 */
export function AnimatedBar({
  pct,
  className = 'h-full rounded-full bg-cribl-blue',
  color,
  durationMs = 700,
}: {
  /** Fill width in percent (0-100). Values outside that range are clamped. */
  pct: number
  /** Class names applied to the fill element. Defaults to a Cribl blue bar. */
  className?: string
  /** Optional inline background color override (used by completeness bars). */
  color?: string
  /** Override the default 700ms transition if a chart wants a snappier feel. */
  durationMs?: number
}) {
  const { animated, enabled } = useEntryAnimation()
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div
      className={className}
      style={{
        width: `${animated ? clamped : 0}%`,
        backgroundColor: color,
        transition: enabled
          ? `width ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`
          : undefined,
      }}
    />
  )
}
