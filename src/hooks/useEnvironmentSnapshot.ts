import { useCallback, useEffect, useState } from 'react'
import { kvDelete, kvGet, kvSet } from '../lib/kvStore'
import {
  ENVIRONMENT_STORAGE_KEY,
  type CriblEnvironmentSnapshot,
} from '../lib/criblEnvironmentTypes'
import { migrateEnvironmentSnapshot } from '../lib/migrateEnvironmentSnapshot'

export function useEnvironmentSnapshot() {
  const [snapshot, setSnapshotState] = useState<CriblEnvironmentSnapshot | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const raw = await kvGet<unknown>(ENVIRONMENT_STORAGE_KEY, null)
      if (!cancelled) {
        setSnapshotState(raw ? migrateEnvironmentSnapshot(raw) : null)
        setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setSnapshot = useCallback((next: CriblEnvironmentSnapshot | null) => {
    setSnapshotState(next)
    if (next) {
      void kvSet(ENVIRONMENT_STORAGE_KEY, next)
    } else {
      void kvDelete(ENVIRONMENT_STORAGE_KEY)
    }
  }, [])

  return { snapshot, setSnapshot, hydrated }
}
