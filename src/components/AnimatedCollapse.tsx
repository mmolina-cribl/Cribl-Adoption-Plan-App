import { type CSSProperties, type ReactNode } from 'react'
import { useAnimationsEnabled, usePrefersReducedMotion } from '../lib/animationsPreference'

type Props = {
  /** Open / closed state; transitions smoothly on change. */
  open: boolean
  /** Override the transition duration (ms). Default 220ms feels snappy. */
  durationMs?: number
  /** Pass-through DOM id, used by the toggle button's `aria-controls`. */
  id?: string
  /** Optional ARIA role (e.g. `'region'`) to wrap the body semantically. */
  role?: string
  /** ID of the toggle / heading element labelling this region. */
  'aria-labelledby'?: string
  className?: string
  children: ReactNode
}

/**
 * Smoothly animates between collapsed (0 height) and open (auto height)
 * using the modern `grid-template-rows: 0fr → 1fr` pattern. Children stay
 * mounted in both states — they're visually hidden via the 0-height grid
 * track + `overflow: hidden`, and additionally hidden from screen
 * readers via `aria-hidden` while closed.
 *
 * Why this approach instead of `max-height`:
 *   - `max-height` requires guessing the open height; too small clips,
 *     too large makes the timing feel sluggish (the transition keeps
 *     animating past the natural end).
 *   - `grid-template-rows: 0fr → 1fr` transitions exactly to the
 *     content's intrinsic height, regardless of how tall it ends up.
 *
 * Browser support: Chrome 117+, Firefox 121+, Safari 17.4+. Older
 * browsers snap instantly between states (functionally fine, just no
 * animation), which matches the behaviour we'd give a user who has
 * "Animations enabled" off in Settings.
 *
 * Respects both:
 *   - The app's "Animations enabled" preference (Settings page)
 *   - The OS's `prefers-reduced-motion: reduce` media query
 *
 * If either is off, the component snaps instantly with no transition.
 */
export function AnimatedCollapse({
  open,
  durationMs = 220,
  id,
  role,
  'aria-labelledby': ariaLabelledby,
  className,
  children,
}: Props) {
  const animationsEnabled = useAnimationsEnabled()
  const reducedMotion = usePrefersReducedMotion()
  const animate = animationsEnabled && !reducedMotion

  const style: CSSProperties = {
    display: 'grid',
    gridTemplateRows: open ? '1fr' : '0fr',
    transition: animate ? `grid-template-rows ${durationMs}ms ease` : 'none',
  }

  return (
    <div
      id={id}
      role={role}
      aria-labelledby={ariaLabelledby}
      aria-hidden={open ? undefined : true}
      className={className}
      style={style}
    >
      {/*
       * The inner wrapper carries `min-h-0 overflow-hidden`. Without
       * `min-h-0` the inner element would refuse to shrink below its
       * intrinsic height (default behaviour for grid items) and the
       * collapse animation would skip. `overflow-hidden` keeps the
       * children clipped while the row track is animating.
       */}
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
