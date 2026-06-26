import { describe, expect, it } from 'vitest'
import {
  clampPanelPosition,
  DEFAULT_ENV_DETAIL_PANEL_POSITION,
  panelPositionFromPixels,
  panelPositionToPixels,
} from './environmentDetailPanelPosition'

describe('environmentDetailPanelPosition', () => {
  it('round-trips ratio position through pixels', () => {
    const px = panelPositionToPixels(DEFAULT_ENV_DETAIL_PANEL_POSITION, 800, 600)
    const stored = panelPositionFromPixels(px.x, px.y, 800, 600)
    expect(stored.xRatio).toBeCloseTo(DEFAULT_ENV_DETAIL_PANEL_POSITION.xRatio, 2)
    expect(stored.yRatio).toBeCloseTo(DEFAULT_ENV_DETAIL_PANEL_POSITION.yRatio, 2)
  })

  it('clamps panel inside container bounds', () => {
    const clamped = clampPanelPosition(900, 900, 320, 400, 800, 600)
    expect(clamped.x).toBeLessThanOrEqual(800 - 320 - 12)
    expect(clamped.y).toBeLessThanOrEqual(600 - 400 - 12)
    expect(clamped.x).toBeGreaterThanOrEqual(12)
    expect(clamped.y).toBeGreaterThanOrEqual(48)
  })
})
