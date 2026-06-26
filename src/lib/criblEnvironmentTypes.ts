/** Read-only snapshot of Cribl routing topology (not the adoption workbook plan). */

import type { CriblEnvironmentConfig } from './environmentConfigRedact'

export type { CriblEnvironmentConfig }

export const ENVIRONMENT_SNAPSHOT_VERSION = 2 as const

export type CriblEnvironmentPipelineFunction = {
  id: string
  disabled?: boolean
  filter?: string
  conf?: CriblEnvironmentConfig
  sourcePath?: string
}

export type CriblEnvironmentInput = {
  id: string
  type?: string
  disabled?: boolean
  description?: string
  config?: CriblEnvironmentConfig
}

export type CriblEnvironmentPipeline = {
  id: string
  disabled?: boolean
  description?: string
  config?: CriblEnvironmentConfig
  functions?: CriblEnvironmentPipelineFunction[]
  sourcePath?: string
}

export type CriblEnvironmentOutput = {
  id: string
  type?: string
  disabled?: boolean
  config?: CriblEnvironmentConfig
}

export type CriblEnvironmentRoute = {
  id: string
  name?: string
  filter?: string
  pipeline?: string
  output?: string
  disabled?: boolean
  config?: CriblEnvironmentConfig
}

export type CriblEnvironmentScopeKind = 'cribl' | 'edge' | 'pack'

/** One routing scope: worker-group cribl/edge product tree or an installed pack. */
export type CriblEnvironmentScope = {
  id: string
  label: string
  kind: CriblEnvironmentScopeKind
  inputs: CriblEnvironmentInput[]
  routes: CriblEnvironmentRoute[]
  pipelines: CriblEnvironmentPipeline[]
  outputs: CriblEnvironmentOutput[]
}

export type CriblEnvironmentGroup = {
  id: string
  label: string
  kind: 'stream' | 'edge'
  scopes: CriblEnvironmentScope[]
}

export type CriblEnvironmentSnapshot = {
  snapshotVersion?: number
  capturedAt: string
  source: 'tenant' | 'diag'
  warnings: string[]
  groups: CriblEnvironmentGroup[]
}

export const ENVIRONMENT_STORAGE_KEY = 'environment' as const

export function emptyEnvironmentSnapshot(): CriblEnvironmentSnapshot {
  return {
    snapshotVersion: ENVIRONMENT_SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    source: 'diag',
    warnings: [],
    groups: [],
  }
}

export function productScopeIdForGroup(kind: 'stream' | 'edge'): 'cribl' | 'edge' {
  return kind === 'edge' ? 'edge' : 'cribl'
}

export function productScopeLabel(kind: 'stream' | 'edge'): string {
  return kind === 'edge' ? 'Edge' : 'Worker group'
}

/** Breadcrumb / map title for a routing scope. */
export function environmentScopeDisplayLabel(scope: Pick<CriblEnvironmentScope, 'id' | 'label' | 'kind'>): string {
  if (scope.kind === 'pack') {
    return `Pack: ${scope.id}`
  }
  return scope.label
}

export type EnvironmentScopeBadge = 'Pack' | 'Worker group' | 'Edge'

export function environmentScopeBadge(
  scope: Pick<CriblEnvironmentScope, 'id' | 'label' | 'kind'>,
): EnvironmentScopeBadge | undefined {
  if (scope.kind === 'pack') {
    return 'Pack'
  }
  if (scope.kind === 'edge') {
    return 'Edge'
  }
  if (scope.kind === 'cribl') {
    return 'Worker group'
  }
  return undefined
}

/** Primary title on scope picker cards (pack id vs product label). */
export function environmentScopeCardTitle(scope: Pick<CriblEnvironmentScope, 'id' | 'label' | 'kind'>): string {
  if (scope.kind === 'pack') {
    return scope.id
  }
  return scope.label
}
