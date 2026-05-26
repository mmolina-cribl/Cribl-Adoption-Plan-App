import type { ReactNode } from 'react'

const LINK_CLASS =
  'text-cribl-primary underline decoration-cribl-primary/40 underline-offset-2 hover:decoration-cribl-primary'

function isAllowedHref(href: string): boolean {
  try {
    const u = new URL(href)
    if (u.protocol === 'https:') {
      return true
    }
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/** Strip trailing punctuation often pasted after URLs in prose. */
function trimUrlTail(raw: string): string {
  let s = raw
  const trimChars = ').,;:!?\'"&>]'
  while (s.length > 0 && trimChars.includes(s[s.length - 1]!)) {
    s = s.slice(0, -1)
  }
  return s
}

function linkifyPlainInSpan(text: string, keyPrefix: string, enabled: boolean): ReactNode {
  if (!enabled || (!text.includes('https://') && !text.includes('http://'))) {
    return text
  }
  const re = /\b(https?:\/\/[^\s<]+)/gi
  const bits: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      bits.push(text.slice(last, m.index))
    }
    const raw = m[1]
    const href = trimUrlTail(raw)
    if (isAllowedHref(href)) {
      bits.push(
        <a
          key={`${keyPrefix}-u-${k++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          {href}
        </a>,
      )
    } else {
      bits.push(m[0])
    }
    last = m.index + m[0].length
  }
  if (last < text.length) {
    bits.push(text.slice(last))
  }
  if (bits.length === 0) {
    return text
  }
  if (bits.length === 1 && typeof bits[0] === 'string') {
    return bits[0]
  }
  return <>{bits}</>
}

function renderBoldParts(text: string, keyPrefix: string, linkifyPlain: boolean): ReactNode[] {
  const re = /\*\*([^*]+)\*\*/g
  const parts: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(
        <span key={`${keyPrefix}-s-${k}`}>
          {linkifyPlainInSpan(text.slice(last, m.index), `${keyPrefix}-sl-${k}`, linkifyPlain)}
        </span>,
      )
    }
    k++
    parts.push(
      <strong key={`${keyPrefix}-b-${k}`} className="font-semibold text-neutral-900">
        {linkifyPlain ? linkifyPlainInSpan(m[1], `${keyPrefix}-bst-${k}`, true) : m[1]}
      </strong>,
    )
    last = re.lastIndex
  }
  if (last < text.length) {
    parts.push(
      <span key={`${keyPrefix}-s-end`}>
        {linkifyPlainInSpan(text.slice(last), `${keyPrefix}-se`, linkifyPlain)}
      </span>,
    )
  }
  if (parts.length === 0) {
    return [<span key={keyPrefix}>{linkifyPlainInSpan(text, `${keyPrefix}-all`, linkifyPlain)}</span>]
  }
  return parts
}

function renderInlineRich(text: string, keyPrefix: string, linkifyPlain: boolean): ReactNode {
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) {
      out.push(...renderBoldParts(text.slice(last, m.index), `${keyPrefix}-t-${k++}`, linkifyPlain))
    }
    const label = m[1]
    const hrefRaw = m[2]
    const href = trimUrlTail(hrefRaw)
    if (isAllowedHref(href)) {
      out.push(
        <a
          key={`${keyPrefix}-a-${k++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          {label}
        </a>,
      )
    } else {
      out.push(<span key={`${keyPrefix}-raw-${k++}`}>{m[0]}</span>)
    }
    last = linkRe.lastIndex
  }
  if (last < text.length) {
    out.push(...renderBoldParts(text.slice(last), `${keyPrefix}-tail`, linkifyPlain))
  }
  if (out.length === 0) {
    return <>{renderBoldParts(text, keyPrefix, linkifyPlain)}</>
  }
  return <>{out}</>
}

type AssistantMessageRichProps = {
  text: string
  className?: string
  /**
   * When true, bare `https://…` / `http://localhost…` in text segments become links
   * (in addition to `[label](url)` markdown). Useful for Additional notes previews.
   */
  linkifyPlainUrls?: boolean
}

/**
 * Renders assistant/user message text with clickable `[label](https://…)` links,
 * optional bare-URL linkification, `**bold**`, and simple `###` headings.
 */
export function AssistantMessageRich({ text, className, linkifyPlainUrls = false }: AssistantMessageRichProps) {
  const lines = text.split('\n')
  return (
    <div className={className}>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) {
          return <div key={i} className="h-1 shrink-0" aria-hidden />
        }
        const hm = /^#{1,6}\s+(.+)$/.exec(trimmed)
        if (hm) {
          return (
            <div
              key={i}
              className="break-words pt-1 text-xs font-semibold tracking-tight text-neutral-900 first:pt-0"
            >
              {renderInlineRich(hm[1], `ln-${i}`, linkifyPlainUrls)}
            </div>
          )
        }
        return (
          <div key={i} className="break-words whitespace-pre-wrap leading-relaxed">
            {renderInlineRich(line, `ln-${i}`, linkifyPlainUrls)}
          </div>
        )
      })}
    </div>
  )
}
