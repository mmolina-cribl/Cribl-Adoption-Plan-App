import type { ImgHTMLAttributes } from 'react'

type IconProps = { className?: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>

/**
 * Cribl AI mark — lightbulb on a teal circle (`/cribl-ai-icon.png`).
 *
 * Currently only consumed by `AiAgentPlaceholderPanel`, which is dead code in
 * the current product (the AI rail was removed pending a future revisit). Kept
 * here so the panel still type-checks; if the AI rail comes back, this is
 * already wired up and the corresponding asset can be added to `public/`.
 */
export function CriblAiIcon({ className, ...img }: IconProps) {
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
