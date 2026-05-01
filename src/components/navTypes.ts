/**
 * What the main content area shows. v2.0 split the worker-group concept
 * into Stream worker groups (`'workerGroups'`) and Edge fleets (`'fleets'`)
 * and surfaces them as separate left-nav sections + index pages. The
 * per-row detail view (`'workerGroup'`) still serves both kinds — the row
 * itself carries the `kind` discriminator.
 */
export type MainView =
  | 'overview'
  | 'workerGroups'
  | 'fleets'
  | 'sources'
  | 'settings'
  | 'workerGroup'
  | 'source'
  | 'import'
  | 'export'
