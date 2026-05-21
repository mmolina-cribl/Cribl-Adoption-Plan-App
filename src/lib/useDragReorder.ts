import { useCallback, useState } from 'react'

/**
 * Where to drop relative to the row currently under the cursor.
 *
 *   - `'before'` → insert the dragged item directly before the target row.
 *   - `'after'`  → insert the dragged item directly after the target row.
 *
 * Computed by comparing the cursor Y coordinate to the target row's
 * vertical midpoint, so a single row gives both "drop above" and "drop
 * below" affordances without needing extra spacer elements between rows.
 *
 * When {@link DragReorderOptions.nestAffinity} returns true for the active
 * drag pair, the bottom band of the row becomes a third `'nest'` target
 * (Edge fleets → sub-fleet of the hovered top-level fleet).
 */
export type DropPosition = 'before' | 'after' | 'nest'

/**
 * Result of {@link useDragReorder}. Each helper returns a small bag of
 * props you spread onto the relevant element:
 *
 *   - {@link DragReorder.getHandleProps}: spread onto the *grip* element
 *     (the small drag-handle icon at the start of each row). It carries
 *     `draggable=true` plus `onDragStart` / `onDragEnd` wiring. Putting
 *     `draggable` on the grip — instead of the whole row — keeps text
 *     selection and clicks on the row's name button working normally;
 *     only grabbing the grip initiates a drag.
 *   - {@link DragReorder.getRowProps}: spread onto each *row container*.
 *     It carries `onDragOver` (computes before/after and exposes the
 *     drop target), `onDragLeave`, and `onDrop`.
 *
 * Section-level state (`draggingId`, `overId`, `overPosition`) is
 * exposed so callers can render drop indicators and reduce opacity on
 * the row currently being dragged.
 *
 * Drag scope is restricted to a single section (Sources, Stream WGs,
 * Edge fleets). The {@link DragReorderOptions.canDropOn} predicate is
 * checked on every `onDragOver` so a Stream WG can't be dropped onto an
 * Edge fleet (and vice versa) even though both sections share the same
 * underlying `WorkerGroupRow` shape.
 */
export type DragReorder = {
  draggingId: string | null
  overId: string | null
  overPosition: DropPosition | null
  getHandleProps: (id: string) => {
    draggable: boolean
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
  getRowProps: (id: string) => {
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

export type DragReorderOptions = {
  /**
   * Called once a valid drop is committed. The handler should mutate
   * the underlying plan array so `fromId` lands directly before/after
   * `toId`. No-op moves (same id, identical resulting position) are
   * filtered before this fires.
   */
  onReorder: (fromId: string, toId: string, position: DropPosition) => void
  /**
   * Optional gate that prevents drops onto a target. Used to keep
   * Stream worker groups out of the Edge fleets section even though
   * both sections share the row component. Defaults to "always allow".
   */
  canDropOn?: (fromId: string, toId: string) => boolean
  /**
   * When true for `(draggingId, targetRowId)`, the row exposes a third
   * vertical band (bottom of the row) mapped to `'nest'` instead of the
   * default two-way before/after split.
   */
  nestAffinity?: (fromId: string, toId: string) => boolean
}

/**
 * Tiny native-HTML5 drag-and-drop coordinator for vertical lists in
 * the left navigation. Lists are short; the hook stays dependency-free.
 * Callers may also wire **keyboard** moves (Alt+↑/↓ on the grip) and **A–Z**
 * sort in `PlanSidebar` — those call the same `onReorder` contract.
 *
 * Touch: HTML5 D&D is still inconsistent on iOS Safari; coarse-pointer
 * styling on the grip improves tablets that show this rail.
 *
 * The hook is intentionally type-erased over `string` ids: the caller
 * looks up the actual row by id when committing the move, so this hook
 * doesn't have to know whether it's reordering sources or WGs.
 */
export function useDragReorder({
  onReorder,
  canDropOn,
  nestAffinity,
}: DragReorderOptions): DragReorder {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [overPosition, setOverPosition] = useState<DropPosition | null>(null)

  const reset = useCallback(() => {
    setDraggingId(null)
    setOverId(null)
    setOverPosition(null)
  }, [])

  const getHandleProps = useCallback(
    (id: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        // Use the native dataTransfer payload so the drag survives a
        // round-trip through the platform: the payload is opaque to us
        // (we look up the dragged row from React state), but Firefox
        // refuses to fire `dragstart` without a `setData` call.
        try {
          e.dataTransfer.setData('text/plain', id)
        } catch {
          // Some browsers throw under DnD restrictions (e.g. inside
          // sandboxed iframes). The drag still works — we read state
          // from React, not the DataTransfer object — so swallow.
        }
        e.dataTransfer.effectAllowed = 'move'
        // Derive the drag image element from the grip's DOM parent so
        // the cursor previews the *whole* row rather than just the
        // grip icon. The grip is rendered as the first child of the
        // inner row container, so `parentElement` always resolves to
        // that container in our layout. Offset by 12px so the preview
        // doesn't sit directly under the pointer (and so the user can
        // see what's *underneath* the preview when picking a drop
        // target). Reading from `e.currentTarget` avoids passing a
        // ref through this hook, which would trip the
        // `react-hooks/refs` lint rule.
        const grip = e.currentTarget as HTMLElement
        const row = grip.parentElement
        if (row) {
          e.dataTransfer.setDragImage(row, 12, 12)
        }
        setDraggingId(id)
      },
      onDragEnd: reset,
    }),
    [reset],
  )

  const getRowProps = useCallback(
    (id: string) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!draggingId || draggingId === id) {
          return
        }
        if (canDropOn && !canDropOn(draggingId, id)) {
          // Disallowed target — hide the drop indicator entirely so
          // the user gets a clear "no" cue (the platform's "no drop"
          // cursor) rather than a misleading insertion line.
          if (overId !== null || overPosition !== null) {
            setOverId(null)
            setOverPosition(null)
          }
          return
        }
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const y = e.clientY - rect.top
        const h = rect.height || 1
        let next: DropPosition
        if (nestAffinity?.(draggingId, id)) {
          if (y < h * 0.36) {
            next = 'before'
          } else if (y < h * 0.68) {
            next = 'after'
          } else {
            next = 'nest'
          }
        } else {
          next = y < h / 2 ? 'before' : 'after'
        }
        if (overId !== id || overPosition !== next) {
          setOverId(id)
          setOverPosition(next)
        }
      },
      onDragLeave: (e: React.DragEvent) => {
        // `dragleave` fires when the cursor crosses any child element
        // boundary too, so guard with `relatedTarget` to ignore those
        // intra-row transitions. We only clear the indicator when the
        // pointer leaves the row container entirely.
        const node = e.currentTarget as HTMLElement
        const next = e.relatedTarget as Node | null
        if (next && node.contains(next)) {
          return
        }
        if (overId === id) {
          setOverId(null)
          setOverPosition(null)
        }
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const from = draggingId
        const pos = overPosition
        reset()
        if (!from || from === id || !pos) {
          return
        }
        if (canDropOn && !canDropOn(from, id)) {
          return
        }
        onReorder(from, id, pos)
      },
    }),
    [canDropOn, nestAffinity, draggingId, onReorder, overId, overPosition, reset],
  )

  return { draggingId, overId, overPosition, getHandleProps, getRowProps }
}
