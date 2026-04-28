import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { PlanState, WorkerGroupRow } from '../types/planTypes'

export type PatchWg = (k: keyof WorkerGroupRow, v: string) => void

/**
 * Returns a stable patcher that mutates a single field on a single
 * worker group inside the plan. Lives in its own file so React Fast
 * Refresh can keep working — co-locating a hook with a component
 * export disables Fast Refresh for the whole module.
 */
export function usePatchWorkerGroup(
  setPlan: Dispatch<SetStateAction<PlanState>>,
  groupId: string,
): PatchWg {
  return useCallback(
    (k, v) => {
      setPlan((p) => {
        if (!p.workerGroups.some((x) => x.id === groupId)) {
          return p
        }
        return {
          ...p,
          workerGroups: p.workerGroups.map((x) => (x.id === groupId ? { ...x, [k]: v } : x)),
        }
      })
    },
    [setPlan, groupId],
  )
}
