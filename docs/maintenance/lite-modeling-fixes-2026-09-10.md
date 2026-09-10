# Lite modeling fixes — 2026-09-10

First selective migration from Zatom into Lite, based on upstream fixes
`4f7c7e12`, `097aee53`, and `d94a190a`. Adapted to Lite's existing document
loaders and viewport layout rather than merging the full application.

## Included

- Element pair overrides use elements in the active structure.
- HyperStick supports orthographic rays, conservative surface bounds, bond size,
  and isolated atoms. GTAO uses procedural surface normals rather than proxy boxes.
- Periodic imports start with bonds hidden; molecular imports start with bonds
  visible. XYZ edit operations preserve the user's visibility setting.
- XYZ imports retain per-axis PBC, including nonperiodic boxed structures.
- Fold-in and image display use fixed cell vectors. Supercell operations retain
  edited geometry and explicit topology in the supported fork path.
- Orthographic is the default projection. Periodic quick views distinguish
  lattice axes from Miller plane normals, with compact hover transitions.
- System appearance is the default; viewport, cell lines and chrome share the
  resolved palette. Stored presentation backgrounds are not overwritten.
- React root reuse during hot reload.

## Verification

Passed: 145 Vitest files / 1167 tests; 143 assert-style files; TypeScript;
production build; Lite boundary and comment checks; Web CSP/build verification.

Automated coverage includes bond pair defaults, HyperStick radius/bounds,
procedural occlusion material restoration, XYZ PBC defaults, wrapping, supercell
editing and topology, projection switching, and theme presentation.

Local production-preview browser checks: HCP Mg template loads with bonds off;
HyperStick retains both isolated atoms; adding an Mg–Mg override renders the
surface; Bond Size changes are accepted; default projection is orthographic;
dark appearance retints viewport and chrome together. No console errors observed.
WebMCP registration and a read-only viewer observation succeeded.

## Deferred

The new crystal creation workflow/dialog and RDKit runtime changes are separate
migration work. Full-application-only features remain outside Lite's boundary. No production deployment is included in this change.

## Local development

With the current Vite configuration, the runner loader can fail while loading the
conditional development bridge. The standard bundle loader starts successfully:
`npm run dev -- --configLoader bundle`. Production build and preview are unaffected.
