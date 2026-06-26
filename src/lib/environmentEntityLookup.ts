import type {
  CriblEnvironmentGroup,
  CriblEnvironmentInput,
  CriblEnvironmentOutput,
  CriblEnvironmentPipeline,
  CriblEnvironmentRoute,
  CriblEnvironmentScope,
  CriblEnvironmentSnapshot,
} from './criblEnvironmentTypes'
import type { EnvironmentEntityRef } from './environmentFlowGraph'

export type ResolvedEnvironmentEntity =
  | { kind: 'input'; group: CriblEnvironmentGroup; scope: CriblEnvironmentScope; entity: CriblEnvironmentInput }
  | { kind: 'route'; group: CriblEnvironmentGroup; scope: CriblEnvironmentScope; entity: CriblEnvironmentRoute }
  | { kind: 'pipeline'; group: CriblEnvironmentGroup; scope: CriblEnvironmentScope; entity: CriblEnvironmentPipeline }
  | { kind: 'output'; group: CriblEnvironmentGroup; scope: CriblEnvironmentScope; entity: CriblEnvironmentOutput }

export function resolveEnvironmentEntity(
  snapshot: CriblEnvironmentSnapshot,
  ref: EnvironmentEntityRef,
): ResolvedEnvironmentEntity | null {
  const group = snapshot.groups.find((g) => g.id === ref.groupId)
  if (!group) {
    return null
  }
  const scope = group.scopes.find((s) => s.id === ref.scopeId)
  if (!scope) {
    return null
  }
  if (ref.entity === 'input') {
    const entity = scope.inputs.find((i) => i.id === ref.id)
    return entity ? { kind: 'input', group, scope, entity } : null
  }
  if (ref.entity === 'route') {
    const entity = scope.routes.find((r) => r.id === ref.id)
    return entity ? { kind: 'route', group, scope, entity } : null
  }
  if (ref.entity === 'pipeline') {
    const entity = scope.pipelines.find((p) => p.id === ref.id)
    return entity ? { kind: 'pipeline', group, scope, entity } : null
  }
  const entity = scope.outputs.find((o) => o.id === ref.id)
  return entity ? { kind: 'output', group, scope, entity } : null
}
