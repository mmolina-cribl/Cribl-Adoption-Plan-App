import type { ImgHTMLAttributes, ReactNode } from 'react'

const alt = 'Cribl'

type WordmarkProps = { className?: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>

/** Full corporate wordmark (black + cyan) from Cribl brand assets. */
export function CriblWordmark({ className, ...img }: WordmarkProps) {
  return (
    <img
      src="/cribl-wordmark.svg"
      alt={alt}
      className={['h-5 w-auto sm:h-6', className].filter(Boolean).join(' ')}
      decoding="async"
      {...img}
    />
  )
}

/** Cyan C mark only — use for tight layouts (nav rail, favicon-style slots). */
export function CriblMark({ className, ...img }: WordmarkProps) {
  return (
    <img
      src="/cribl-mark.svg"
      alt=""
      role="presentation"
      className={['h-6 w-6 sm:h-7 sm:w-7', className].filter(Boolean).join(' ')}
      decoding="async"
      {...img}
    />
  )
}

/** Cribl AI mark — lightbulb on a teal circle (`/cribl-ai-icon.png`). */
export function CriblAiIcon({ className, ...img }: WordmarkProps) {
  return (
    <img
      src="/cribl-ai-icon.png"
      alt=""
      role="presentation"
      className={className}
      decoding="async"
      {...img}
    />
  )
}

type BrandBlockProps = {
  title: ReactNode
  /** Optional; omit for title-only header rows. */
  subtitle?: ReactNode
  /**
   * `default` — wordmark stacked above title + optional subtitle;
   * `compact` — C mark + title + optional subtitle in one block;
   * `wordmarkRow` — full wordmark left, title to the right (and optional subtitle below the title only).
   */
  variant?: 'default' | 'compact' | 'wordmarkRow'
  className?: string
}

/** Header: wordmark with product title. */
export function CriblHeaderBrand({ title, subtitle, variant = 'default', className = '' }: BrandBlockProps) {
  if (variant === 'compact') {
    return (
      <div className={`flex min-w-0 items-start gap-2.5 ${className}`}>
        <CriblMark className="shrink-0" />
        <div className="min-w-0">
          {title}
          {subtitle}
        </div>
      </div>
    )
  }
  if (variant === 'wordmarkRow') {
    return (
      <div
        className={`flex min-w-0 items-center gap-2.5 font-cribl-mkt sm:gap-3.5 ${className}`}
      >
        <CriblWordmark className="shrink-0" />
        <div className="min-w-0 self-center">
          {title}
          {subtitle}
        </div>
      </div>
    )
  }
  return (
    <div className={`min-w-0 space-y-2.5 ${className}`}>
      <CriblWordmark className="block" />
      <div className="min-w-0">
        {title}
        {subtitle}
      </div>
    </div>
  )
}

type RailBlockProps = { className?: string }
/** Rail top: C mark only (narrow column; full wordmark lives in the page header). */
export function CriblRailBrand({ className = '' }: RailBlockProps) {
  return (
    <div
      className={`-mt-1 flex items-center justify-center px-1 pb-3.5 pt-0.5 ${className}`}
    >
      <div className="shrink-0" aria-label={alt} title="Cribl" role="img">
        <CriblMark className="!h-11 !w-11 sm:!h-12 sm:!w-12" />
      </div>
    </div>
  )
}
