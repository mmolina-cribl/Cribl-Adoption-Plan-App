# Cribl Adoption Plan Tool Roadmap

This roadmap is the project-facing source of truth for upcoming themes. It is
intentionally lightweight: items here come from real CSE / PS usage and feedback,
but they are not committed delivery dates.

Detailed implementation history belongs in [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md);
new product/UX direction belongs here first.

## Near Term

- Continue hardening Excel import/export against real customer workbooks,
  especially legacy `v0.8.6` imports and current `v0.9.1` round-trips.
- Improve standalone HTML/on-prem guidance, including a customer-facing
  one-pager that explains purpose, data access, network behavior, and
  storage boundaries.
- Add clearer in-app version visibility so bug reports are easier to triage
  across `.tgz`, standalone HTML, and locally running builds.
- Improve validation and user-facing error messages when import/export detects
  an unsupported, malformed, or partially migrated workbook.

## Planned Exploration

- Add Edge subfleet support across the planning workflow:
  - data model support for fleets with child subfleets
  - left-nav and resource-map UX for nested Edge collection targets
  - source assignment at the correct fleet/subfleet level
  - capacity rollups across parent fleets and child subfleets
  - Excel import/export representation that stays compatible with the
    Adoption Plan workbook handoff
- Rename WG-prefixed shared modules and UI internals to kind-neutral names once
  the current Stream/Fleet behavior settles. Examples include
  `WorkerGroupResourceMap`, `WorkerGroupDetailView`, and `WorkerGroupEditor`,
  which now serve both Stream worker groups and Edge fleets despite the legacy
  naming.
- Add more guided defaults/templates for common adoption scenarios so CSEs can
  start a customer plan faster.
- Improve customer-facing summary/readout views for discovery, scoping, and
  handoff conversations.
- Polish the Activation workflow based on PS feedback from real engagements.

## Not Currently Planned

- Replacing the Adoption Plan Excel workbook as the handoff artifact.
- Multi-user collaboration inside the standalone HTML build.
- A customer-facing hosted service/SaaS version.
