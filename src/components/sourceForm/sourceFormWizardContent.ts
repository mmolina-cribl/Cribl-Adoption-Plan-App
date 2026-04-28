/**
 * Section anchors in the full-page Source summary (for “View full form” scroll).
 */
export const SOURCE_SECTION_ANCHOR = {
  primary: (rowId: string) => `ss-${rowId}-primary`,
  volume: (rowId: string) => `ss-${rowId}-volume`,
  roadmap: (rowId: string) => `ss-${rowId}-roadmap`,
  value: (rowId: string) => `ss-${rowId}-value`,
} as const
