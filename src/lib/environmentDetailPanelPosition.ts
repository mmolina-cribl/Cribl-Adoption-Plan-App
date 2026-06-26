import { getSafeLocalStorage } from './safeLocalStorage'

const LS_ENV_DETAIL_PANEL_POSITION = 'adoption-plan-environment-detail-panel-position'

export type EnvironmentDetailPanelPosition = {
  xRatio: number
  yRatio: number
}

export const DEFAULT_ENV_DETAIL_PANEL_POSITION: EnvironmentDetailPanelPosition = {
  xRatio: 0.018,
  yRatio: 0.14,
}

const MIN_EDGE = 12
const MIN_TOP = 48

function clampRatio(n: number): number {
  if (!Number.isFinite(n)) {
    return 0
  }
  return Math.max(0, Math.min(1, n))
}

export function readEnvironmentDetailPanelPosition(): EnvironmentDetailPanelPosition {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return DEFAULT_ENV_DETAIL_PANEL_POSITION
  }
  try {
    const raw = ls.getItem(LS_ENV_DETAIL_PANEL_POSITION)
    if (!raw) {
      return DEFAULT_ENV_DETAIL_PANEL_POSITION
    }
    const parsed = JSON.parse(raw) as Partial<EnvironmentDetailPanelPosition>
    if (typeof parsed.xRatio === 'number' && typeof parsed.yRatio === 'number') {
      return {
        xRatio: clampRatio(parsed.xRatio),
        yRatio: clampRatio(parsed.yRatio),
      }
    }
  } catch {
    /* ignore corrupt value */
  }
  return DEFAULT_ENV_DETAIL_PANEL_POSITION
}

export function writeEnvironmentDetailPanelPosition(pos: EnvironmentDetailPanelPosition): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  ls.setItem(
    LS_ENV_DETAIL_PANEL_POSITION,
    JSON.stringify({
      xRatio: clampRatio(pos.xRatio),
      yRatio: clampRatio(pos.yRatio),
    }),
  )
}

export function panelPositionToPixels(
  pos: EnvironmentDetailPanelPosition,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { x: MIN_EDGE, y: MIN_TOP }
  }
  return {
    x: Math.round(pos.xRatio * containerWidth),
    y: Math.round(pos.yRatio * containerHeight),
  }
}

export function panelPositionFromPixels(
  x: number,
  y: number,
  containerWidth: number,
  containerHeight: number,
): EnvironmentDetailPanelPosition {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return DEFAULT_ENV_DETAIL_PANEL_POSITION
  }
  return {
    xRatio: clampRatio(x / containerWidth),
    yRatio: clampRatio(y / containerHeight),
  }
}

export function clampPanelPosition(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { x: MIN_EDGE, y: MIN_TOP }
  }
  const maxX = Math.max(MIN_EDGE, containerWidth - panelWidth - MIN_EDGE)
  const maxY = Math.max(MIN_TOP, containerHeight - panelHeight - MIN_EDGE)
  return {
    x: Math.max(MIN_EDGE, Math.min(x, maxX)),
    y: Math.max(MIN_TOP, Math.min(y, maxY)),
  }
}
