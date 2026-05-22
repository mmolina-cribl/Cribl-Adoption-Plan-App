import { useEffect, useMemo, useState } from 'react'
import { AssistantMessageRich } from './AssistantMessageRich'

const PLAIN_CHUNK = 6
const TICK_MS = 17

type Props = {
  text: string
  className?: string
  /** When true, reveal characters over time; when false, show the full message immediately */
  animate: boolean
  /** Called once when a progressive reveal reaches the end (not called if `animate` is false) */
  onRevealComplete?: () => void
}

/**
 * Split `text` into units we reveal in order: each `**…**` pair is one unit (never split),
 * plain regions are split into small chunks so streaming still feels smooth.
 */
function buildRevealUnits(text: string): string[] {
  const units: string[] = []
  const pushPlain = (s: string) => {
    if (s.length === 0) return
    for (let i = 0; i < s.length; i += PLAIN_CHUNK) {
      units.push(s.slice(i, i + PLAIN_CHUNK))
    }
  }

  const parts = text.split('**')
  if (parts.length === 1) {
    pushPlain(parts[0] ?? '')
    return units
  }

  pushPlain(parts[0] ?? '')
  for (let i = 1; i < parts.length; i += 2) {
    const inner = parts[i] ?? ''
    const after = parts[i + 1]
    if (after !== undefined) {
      units.push(`**${inner}**`)
      pushPlain(after)
    } else {
      pushPlain(`**${inner}`)
    }
  }
  return units
}

/**
 * Renders assistant markdown like {@link AssistantMessageRich}, optionally revealing
 * the string progressively for a lightweight “streaming” feel after a non-streaming
 * API response returns.
 *
 * When `animate` is false we always show the full `text`, so a render where `animate`
 * flips true one tick after the message mounts (e.g. non-batched updates) never leaves
 * the first frame stuck at “full text” with no way to reset internal length.
 *
 * Reveal uses bold-safe units so we never split a **pair** and break AssistantMessageRich
 * bold parsing (complete **inner** segments are shown in one step).
 */
export function AssistantMessageReveal({ text, className, animate, onRevealComplete }: Props) {
  const units = useMemo(() => buildRevealUnits(text), [text])
  const [visibleUnits, setVisibleUnits] = useState(0)

  useEffect(() => {
    if (!animate) {
      return
    }

    setVisibleUnits(0)
    if (units.length === 0) {
      queueMicrotask(() => onRevealComplete?.())
      return
    }

    let cancelled = false
    let k = 0

    const id = window.setInterval(() => {
      if (cancelled) return
      k = Math.min(units.length, k + 1)
      setVisibleUnits(k)
      if (k >= units.length) {
        window.clearInterval(id)
        onRevealComplete?.()
      }
    }, TICK_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [text, animate, onRevealComplete, units])

  const displayText = animate ? units.slice(0, visibleUnits).join('') : text
  return <AssistantMessageRich text={displayText} className={className} />
}
