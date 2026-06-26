import type { ExecutiveSummaryAi, PlanState, WorkerGroupRow } from '../types/planTypes'
import { sourceLabel } from '../types/planTypes'
import * as XLSX from 'xlsx'
import { parseGb } from './formatRate'
import { isSourceRowAttachmentDisabled, stripAttachmentDisabledNameSuffix } from './sourceAttachmentDisabled'

export type ExecutiveReadoutNarrativeSection = {
  title: string
  paragraphs: string[]
}

/** One row in the Summary sources inventory (full plan, not a sample). Ordered by GB/d descending. */
export type ExecutiveSourceRow = {
  id: string
  name: string
  /** Leader-disabled / attachment-disabled vs active in the plan editor. */
  state: 'Enabled' | 'Disabled'
  vol: string
  wg: string
  streamOrEdge: string
  sourceTile: string
  blockers: string
}

export type ExecutiveSnapshot = {
  customerName: string
  asOfLabel: string
  provenanceLabel: string
  provenanceDetail: string
  caveats: string[]
  wgStreamCount: number
  wgEdgeCount: number
  sourceCount: number
  activationTier: string | null
  /** Every source row, sorted by average daily GB (largest first; non-numeric / empty last). */
  sources: ExecutiveSourceRow[]
  /** Every worker group / fleet in plan order. */
  workerGroups: Array<{ id: string; name: string; kind: 'stream' | 'edge' }>
  /** Stakeholder-facing narrative blocks (use *term* for emphasis). */
  narrativeSections: ExecutiveReadoutNarrativeSection[]
}

function provenanceCopy(plan: PlanState): { label: string; detail: string; caveats: string[] } {
  const p = plan.planProvenance ?? { kind: 'scratch' as const }
  if (p.kind === 'xlsx') {
    return {
      label: 'Imported from workbook',
      detail: `Loaded from an .xlsx adoption plan file${p.capturedAt ? ` (${p.capturedAt})` : ''}.`,
      caveats: [],
    }
  }
  if (p.kind === 'tenant') {
    const caveats: string[] = [
      'Topology was bootstrapped from the live Cribl tenant — volumes, roadmap, and value fields may still be incomplete until you edit them.',
      'Sources were listed from Leader configured inputs; routing (pipelines / destinations) is not imported — validate in the workbook or source detail.',
      'Edge fleet coverage from tenant harvest may be partial; validate fleets in the editor.',
    ]
    return {
      label: 'Imported from live tenant',
      detail: `Bootstrapped from Cribl Stream / Edge inventory via Leader APIs${p.capturedAt ? ` (${p.capturedAt})` : ''}.`,
      caveats,
    }
  }
  if (p.kind === 'diag') {
    const caveats: string[] = [
      'Topology was parsed from a **diagnostic bundle** snapshot (per-group `groups/<id>/…` config) — it reflects on-disk config at capture time, not live Leader APIs.',
      'Sources come from `inputs.yml` (and `inputs/*.yml`) under each `groups/<id>/` tree; routing is not imported.',
      'If the bundle omitted `groups/*` configs or used an unexpected layout, some groups or sources may be missing — compare with the tenant or Excel.',
      '**Cribl.Cloud** diagnostics are **Leader-centric**; **per-worker / per-node** bundle workflows differ from self-managed Stream — **Import from live tenant** is often the easiest way to hydrate the full plan on Cloud.',
    ]
    return {
      label: 'Imported from diagnostic bundle',
      detail: `Bootstrapped from a Cribl Stream/Edge **.tar.gz** diagnostic bundle${p.capturedAt ? ` (${p.capturedAt})` : ''}.`,
      caveats,
    }
  }
  return {
    label: 'Authored in-app',
    detail: 'Plan data was entered directly in this tool (no file or tenant bootstrap recorded).',
    caveats: [],
  }
}

function wgDisplayName(w: WorkerGroupRow): string {
  return (w.wg ?? '').trim() || w.id
}

function buildExecutiveSourceRows(plan: PlanState): ExecutiveSourceRow[] {
  const wgById = new Map(plan.workerGroups.map((w) => [w.id, w]))
  const rows = plan.sourceSummary.map((r, i) => {
    const wg = r.workerGroupId ? wgById.get(r.workerGroupId) : undefined
    const wgLabel = wg ? wgDisplayName(wg) : '—'
    return {
      id: r.id,
      name: sourceLabel({ source: stripAttachmentDisabledNameSuffix(r.source) }, i),
      state: (isSourceRowAttachmentDisabled(r) ? 'Disabled' : 'Enabled') as ExecutiveSourceRow['state'],
      vol: (r.avgDailyGb ?? '').trim() || '—',
      wg: wgLabel,
      streamOrEdge: (r.streamOrEdge ?? '').trim() || '—',
      sourceTile: (r.sourceTile ?? '').trim() || '—',
      blockers: (r.blockers ?? '').trim() || '—',
    }
  })
  rows.sort((a, b) => {
    const ga = parseGb(a.vol)
    const gb = parseGb(b.vol)
    const va = Number.isFinite(ga) ? ga : Number.NEGATIVE_INFINITY
    const vb = Number.isFinite(gb) ? gb : Number.NEGATIVE_INFINITY
    if (vb !== va) {
      return vb - va
    }
    return a.id.localeCompare(b.id)
  })
  return rows
}

function buildExecutiveSummaryNarrative(args: {
  customerName: string
  wgStreamCount: number
  wgEdgeCount: number
  sourceCount: number
  activationTier: string | null
  workerGroups: Array<{ id: string; name: string; kind: 'stream' | 'edge' }>
  sources: ExecutiveSourceRow[]
}): ExecutiveReadoutNarrativeSection[] {
  const { customerName, wgStreamCount, wgEdgeCount, sourceCount, activationTier, workerGroups, sources } = args

  const sections: ExecutiveReadoutNarrativeSection[] = []

  sections.push({
    title: 'Overview',
    paragraphs: [
      `This readout distills the adoption plan for *${customerName}* into a stakeholder-ready overview.`,
      `It reflects *Stream* and *Edge* worker groups, every planned data source in the tables below, *PS Activation* framing, and risks captured in source *Blockers*. Use *Download summary (.md)* for a portable narrative copy, or *Download sources inventory (.xlsx)* for the full source table as a single Excel sheet.`,
    ],
  })

  const wgNamed =
    workerGroups.length > 0
      ? `Named groups and fleets (${workerGroups.length}): *${workerGroups.map((w) => w.name).join('*, *')}*.`
      : 'No worker groups or fleets are defined yet.'

  sections.push({
    title: 'Topology & inventory',
    paragraphs: [
      `The plan currently shows *${wgStreamCount}* Stream worker group${wgStreamCount === 1 ? '' : 's'} and *${wgEdgeCount}* Edge fleet${wgEdgeCount === 1 ? '' : 's'}, with *${sourceCount}* source row${sourceCount === 1 ? '' : 's'}. ${wgNamed}`,
      `Cross-check the *Groups & fleets* and *Sources* sections on this page (and the workbook export) before you commit to sizing, licensing, or timeline.`,
    ],
  })

  if (activationTier) {
    sections.push({
      title: 'PS Activation framing',
      paragraphs: [
        `Activation is framed at the *${activationTier}* tier. That choice scopes Cribl Services effort, base product coverage, and the use-case checklist in the Activation worksheet.`,
        `Keep it aligned with what you intend to sell and deliver.`,
      ],
    })
  } else {
    sections.push({
      title: 'PS Activation framing',
      paragraphs: [
        `No Activation tier is selected yet. Choosing a tier in the *Activation* view ties the rollout story to a concrete Services scope.`,
        `It also helps executives understand what “done” looks like for the first phase.`,
      ],
    })
  }

  const withVol = sources.filter((s) => s.vol !== '—' && s.vol.trim() !== '')
  if (withVol.length > 0) {
    sections.push({
      title: 'Ingest volumes',
      paragraphs: [
        `*${withVol.length}* source row${withVol.length === 1 ? '' : 's'} include an average daily GB figure. The *Sources* table lists every row with the same values as the plan editor, sorted by average daily GB (largest first).`,
        `Figures reflect what your team entered (or tenant / diagnostic import where applicable). *Validate them with the customer* before capacity, licensing, or sizing commitments.`,
      ],
    })
  } else {
    sections.push({
      title: 'Ingest volumes',
      paragraphs: [
        `No average daily GB values are set on source rows yet.`,
        `Completing per-source average daily GB, collection path, and criticality in the plan makes onboarding and infrastructure conversations much more concrete.`,
      ],
    })
  }

  const withBlockers = sources.filter((s) => s.blockers !== '—' && s.blockers.trim() !== '')
  if (withBlockers.length > 0) {
    sections.push({
      title: 'Near-term risks & follow-ups',
      paragraphs: [
        `*${withBlockers.length}* source row${withBlockers.length === 1 ? '' : 's'} include text in *Blockers* — see the Sources table for the full text per source.`,
        `Resolve or re-scope these in the plan so downstream activation and Services estimates stay credible.`,
      ],
    })
  } else {
    sections.push({
      title: 'Near-term risks & follow-ups',
      paragraphs: [
        `No source-level blockers were captured in the plan yet.`,
        `As the engagement tightens, use the *Blockers* field to log decisions, dependencies, and political risk so this summary stays accurate through delivery.`,
      ],
    })
  }

  return sections
}

/** Turn *emphasis* segments in narrative copy into Markdown **bold**. */
function narrativeStarToMarkdownBold(s: string): string {
  return s.replace(/\*([^*]+)\*/g, '**$1**')
}

/**
 * Serialize the executive Summary to Markdown (mirrors the on-screen readout).
 * When `ai` is set, appends an AI-assisted section (same disclaimer as the UI).
 */
export function executiveSnapshotToMarkdown(snap: ExecutiveSnapshot, ai?: ExecutiveSummaryAi | null): string {
  const lines: string[] = []
  lines.push(`# ${snap.customerName} — Adoption plan summary`)
  lines.push('')
  lines.push(`*Generated ${snap.asOfLabel}*`)
  lines.push('')
  lines.push('## At a glance')
  lines.push('')
  lines.push(`- Stream worker groups: **${snap.wgStreamCount}** — Edge fleets: **${snap.wgEdgeCount}**`)
  lines.push(`- Source rows in plan: **${snap.sourceCount}**`)
  lines.push(
    snap.activationTier
      ? `- PS Activation tier: **${snap.activationTier}**`
      : '- PS Activation tier: *(not set)*',
  )
  lines.push('')
  lines.push('## Narrative')
  lines.push('')
  for (const sec of snap.narrativeSections) {
    lines.push(`### ${sec.title}`)
    lines.push('')
    for (const p of sec.paragraphs) {
      lines.push(narrativeStarToMarkdownBold(p))
      lines.push('')
    }
  }
  lines.push('## Source of plan')
  lines.push('')
  lines.push(`**${snap.provenanceLabel}**`)
  lines.push('')
  lines.push(snap.provenanceDetail)
  lines.push('')
  if (snap.caveats.length > 0) {
    lines.push('### Caveats')
    lines.push('')
    for (const c of snap.caveats) {
      lines.push(`- ${c}`)
    }
    lines.push('')
  }
  lines.push('## Groups & fleets (full inventory)')
  lines.push('')
  if (snap.workerGroups.length === 0) {
    lines.push('*(None)*')
  } else {
    lines.push('| Worker group / fleet | Stream or Edge |')
    lines.push('| --- | --- |')
    for (const w of snap.workerGroups) {
      const kind = w.kind === 'edge' ? 'Edge (fleet)' : 'Stream'
      const esc = (cell: string) =>
        cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
      lines.push(`| ${esc(w.name)} | ${kind} |`)
    }
  }
  lines.push('')
  lines.push('## Sources (full inventory)')
  lines.push('')
  if (snap.sources.length === 0) {
    lines.push('*(No sources in plan.)*')
  } else {
    lines.push('*Rows sorted by average daily GB (largest first).*')
    lines.push('')
    lines.push('| Source | Tile | State | GB/d | Worker group / fleet | Stream/Edge | Blockers |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const s of snap.sources) {
      const esc = (cell: string) =>
        cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
      lines.push(
        `| ${esc(s.name)} | ${esc(s.sourceTile)} | ${s.state} | ${esc(s.vol)} | ${esc(s.wg)} | ${esc(s.streamOrEdge)} | ${esc(s.blockers)} |`,
      )
    }
  }
  lines.push('')
  if (ai?.markdown?.trim()) {
    lines.push('## AI-assisted notes')
    lines.push('')
    lines.push(
      '*The following was generated by an AI model from a capped JSON snapshot of this plan. It is not an independent audit — verify counts, sources, and claims against the tables above and in the workbook.*',
    )
    lines.push('')
    const modelNote = ai.model ? ` *(model: ${ai.model})*` : ''
    lines.push(`*Generated ${ai.generatedAt}*${modelNote}`)
    lines.push('')
    lines.push(ai.markdown.trim())
    lines.push('')
  }
  return lines.join('\n')
}

function sanitizeFilenameBase(name: string): string {
  const t = name.trim() || 'Adoption-plan'
  return t.replace(/[^\w\s-]+/g, '').replace(/\s+/g, '-').slice(0, 80) || 'Adoption-plan'
}

function inventoryCell(value: string): string {
  return value === '—' ? '' : value
}

/** Header row + one row per source for the Summary sources inventory export. */
export function buildExecutiveSourcesInventoryAoA(snap: ExecutiveSnapshot): string[][] {
  const header = ['Source', 'Tile', 'State', 'GB/d', 'WG / fleet', 'Stream/Edge', 'Blockers']
  const rows = snap.sources.map((s) => [
    s.name,
    inventoryCell(s.sourceTile),
    s.state,
    inventoryCell(s.vol),
    inventoryCell(s.wg),
    inventoryCell(s.streamOrEdge),
    inventoryCell(s.blockers),
  ])
  return [header, ...rows]
}

const SOURCES_INVENTORY_SHEET_NAME = 'Sources (full inventory)'

/** Trigger a browser download of the Sources (full inventory) table as a one-sheet .xlsx. */
export function downloadExecutiveSourcesInventoryXlsx(snap: ExecutiveSnapshot): void {
  const ws = XLSX.utils.aoa_to_sheet(buildExecutiveSourcesInventoryAoA(snap))
  ws['!cols'] = [
    { wch: 28 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 22 },
    { wch: 12 },
    { wch: 40 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, SOURCES_INVENTORY_SHEET_NAME)
  if (!wb.Props) wb.Props = {}
  wb.Props.Title = `${snap.customerName} — sources inventory`
  if (snap.customerName.trim()) {
    wb.Props.Subject = snap.customerName.trim()
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const base = sanitizeFilenameBase(snap.customerName)
  const filename = `${base}-sources-inventory-${stamp}.xlsx`
  const ab = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([ab], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Trigger a browser download of the Markdown summary. */
export function downloadExecutiveSummaryMarkdown(snap: ExecutiveSnapshot, ai?: ExecutiveSummaryAi | null): void {
  const md = executiveSnapshotToMarkdown(snap, ai)
  const stamp = new Date().toISOString().slice(0, 10)
  const base = sanitizeFilenameBase(snap.customerName)
  const filename = `${base}-adoption-summary-${stamp}.md`
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function buildExecutiveSnapshot(plan: PlanState): ExecutiveSnapshot {
  const nStream = plan.workerGroups.filter((w) => w.kind === 'stream').length
  const nEdge = plan.workerGroups.filter((w) => w.kind === 'edge').length
  const prov = provenanceCopy(plan)
  const workerGroups = plan.workerGroups.map((w) => ({
    id: w.id,
    name: wgDisplayName(w),
    kind: w.kind,
  }))
  const sources = buildExecutiveSourceRows(plan)

  const customerName = (plan.customerName ?? '').trim() || 'Customer'

  const narrativeSections = buildExecutiveSummaryNarrative({
    customerName,
    wgStreamCount: nStream,
    wgEdgeCount: nEdge,
    sourceCount: plan.sourceSummary.length,
    activationTier: plan.activation.tier,
    workerGroups,
    sources,
  })

  return {
    customerName,
    asOfLabel: new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    provenanceLabel: prov.label,
    provenanceDetail: prov.detail,
    caveats: [
      ...prov.caveats,
      ...((plan.planProvenance?.note ?? '').trim() ? [plan.planProvenance!.note!] : []),
    ],
    wgStreamCount: nStream,
    wgEdgeCount: nEdge,
    sourceCount: plan.sourceSummary.length,
    activationTier: plan.activation.tier,
    sources,
    workerGroups,
    narrativeSections,
  }
}
