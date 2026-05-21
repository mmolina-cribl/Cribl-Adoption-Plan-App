// Build-time-injected virtual modules. Resolved by Vite plugins:
//
//   - In the Cribl-Apps build (`vite.config.ts`):
//     `virtualGoldTemplateStubPlugin` returns hasEmbeddedGoldTemplate=false
//     so the runtime resolver falls through to `getAdoptionPlanEmptyTemplateUrl()`
//     fetch.
//
//   - In the standalone build (`vite.standalone.config.ts`):
//     `inlineGoldTemplatePlugin` returns the base64-encoded gold .xlsx so the
//     runtime resolver can decode it without a network round-trip.
//
// See `src/lib/adoptionPlanTemplateExport.ts` for the runtime usage.

declare module 'virtual:embedded-gold-template' {
  /**
   * Base64-encoded bytes of `public/adoption-plan-empty.xlsx`. Empty
   * string in the Cribl-Apps stub. Decode via `atob` + `Uint8Array.from`
   * (or the helper in `adoptionPlanTemplateExport.ts`).
   */
  export const embeddedGoldTemplateBase64: string

  /**
   * `true` only in the standalone build. Runtime branches on this flag
   * rather than on a separate compile-time constant.
   */
  export const hasEmbeddedGoldTemplate: boolean
}
