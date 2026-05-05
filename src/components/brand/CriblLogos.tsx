import type { ImgHTMLAttributes } from 'react'
import criblAiIconUrl from '../../assets/cribl-ai-icon.png'

type IconProps = { className?: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>

/**
 * Cribl AI mark — lightbulb on a teal circle. Imported via Vite so the
 * asset goes through the bundler in both build targets:
 *
 *   - Cribl Apps build: emitted as `dist/assets/cribl-ai-icon-XXXX.png`
 *     and the `<img src="...">` is rewritten to that fingerprinted URL.
 *   - Standalone build: inlined as a base64 `data:image/png;...` URL
 *     because `assetsInlineLimit` in `vite.standalone.config.ts` is
 *     bumped above this file's ~4 KB size, so the asset is folded
 *     into the bundle and survives `file://` deployment.
 *
 * Currently only consumed by `AiAgentPlaceholderPanel`, which is dead
 * code in the current product (the AI rail was removed pending a future
 * revisit). Kept here so the panel still type-checks; if the AI rail
 * comes back, this is already wired up correctly.
 */
export function CriblAiIcon({ className, ...img }: IconProps) {
  return (
    <img
      src={criblAiIconUrl}
      alt=""
      role="presentation"
      className={className}
      decoding="async"
      {...img}
    />
  )
}
