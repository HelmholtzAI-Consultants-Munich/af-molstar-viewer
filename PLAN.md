# Frontend Evolution Plan For AF Mol* Viewer

## Summary

### Architecture review
- High: [App.tsx](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/app/App.tsx#L21) is the current state hub for import state, loaded data, and all interaction state. That works for one loaded prediction, but it will become brittle once the UI needs target/template pairs, binder lists, compare sessions, and saved views.
- High: [App.tsx](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/app/App.tsx#L35) uses a single `pendingResolver` for worker responses, and [App.tsx](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/app/App.tsx#L97) chains discovery into a fire-and-forget load. Future multi-panel or concurrent loads need request IDs and stale-response protection.
- High: [types.ts](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/lib/types.ts#L41) models the app around one `PredictionBundle` with one structure and one PAE matrix. That is the main mismatch with the README roadmap.
- Medium: [MolstarPanel.tsx](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/components/MolstarPanel.tsx#L235) embeds viewer lifecycle, event wiring, styling, and selection application in one component. For saved states and synchronized comparison, the viewer needs a thinner panel and a reusable controller layer.
- Medium: [helpers.ts](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/lib/adapters/helpers.ts#L42) drops ligands and keeps only generic polymer chains. Future interface/hotspot/cropping features need explicit structure roles and chain-level semantics, not just residue arrays.

### Recommended direction
Refactor the app from “single loaded bundle with one viewer workspace” into “workspace document with multiple structure entries and reusable viewer sessions.” Keep local-file import as the first data source, but stop letting it define the whole domain model.

## Key Changes

### 1. Replace the single-bundle app model
- Keep parsing/adapters as the low-level import layer, but make them output `StructureEntry` records instead of directly defining the whole UI state.
- Introduce a top-level `WorkspaceDocument` state in `App` that owns:
  - imported structures and their metadata
  - semantic roles (`target`, `template`, `binder`, `binder_prediction`)
  - named selections (`hotspots`, `interface`, `crop`)
  - open comparison sessions
  - saved Mol* view states
- Split UI state into document state vs view state. Document state is persistent and shareable; hover/pin/brush state stays per viewer session.

### 2. Add a reusable viewer-session layer
- Extract a viewer controller from `MolstarPanel` that owns Mol* instance creation, highlight/select/focus application, and save/restore of Mol* state snapshots.
- Make `Workspace` render one or more viewer sessions from configuration instead of assuming one fixed PAE + one fixed Mol* panel.
- Use side-by-side synchronized viewers as the primary compare mode:
  - shared selection bus for residue/chain selections
  - optional camera sync
  - independent loaded structures with linked highlighting

### 3. Implement future features as feature slices
- Target/template pair:
  - Add a “structure set” concept in the document for related entries.
  - First workspace preset is a two-structure target/template session.
- Interface/hotspot selection:
  - Store residue selections as named domain objects, not just transient viewer indices.
  - Selection tools should live above Mol* so they can drive 3D view, sequence view, and later forms/actions.
- Cropping:
  - Define crop as a saved residue-range or selection on the target entry.
  - Frontend v1 should create and persist crop definitions plus a cropped view; no irreversible structure rewriting in this phase.
- Generated binders:
  - Add a binder browser panel fed by `StructureEntry[]` grouped under the active target/template context.
  - Binder cards should open detail or comparison sessions, not replace the whole app state.
- AF2-predicted binder structures:
  - Treat these as child entries of a binder candidate, with their own structure/PAE/confidence payloads.
  - Reuse the same viewer-session and selection plumbing as the current single prediction viewer.
- Binder comparison:
  - First-class compare session type with 2-up or 3-up connected viewers.
  - Overlay mode should be deferred until after side-by-side works cleanly.
- Save Mol* states:
  - Save snapshots per viewer session into the `WorkspaceDocument`.
  - State records should reference the structure entry they belong to and store a user label plus Mol* snapshot payload.

### 4. Reorganize the frontend around domain seams
- Keep [App.tsx](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/app/App.tsx) as composition/root state only.
- Move the current cross-cutting types out of [types.ts](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/lib/types.ts) into separate domains: import/parsing types, document types, and viewer-session types.
- Keep [MolstarPanel.tsx](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/components/MolstarPanel.tsx) as a presentational shell over the new viewer controller.

## Public Interfaces / Types

- Replace `PredictionBundle` as the main app state with:
  - `StructureEntry`
  - `WorkspaceDocument`
  - `ViewerSession`
  - `CompareSession`
- Add semantic enums:
  - `StructureRole = 'target' | 'template' | 'binder' | 'binder_prediction'`
  - `SelectionKind = 'hotspot' | 'interface' | 'crop'`
  - `ComparisonLayout = 'single' | 'side-by-side'`
- Keep the existing parsed residue/chain data, but extend entries with:
  - stable IDs
  - parent/child relationships
  - source provenance
  - optional chain-role annotations
- Worker messages should become request/response envelopes with `requestId` so multiple loads can be in flight safely.

## Test Plan

- Add app-level tests for concurrent discovery/load requests and stale-response handling.
- Add reducer/state tests for `WorkspaceDocument` mutations: add structure set, create hotspot selection, create crop, open compare session, save Mol* state.
- Add viewer-session tests for selection sync between side-by-side viewers and state restore behavior.
- Extend import tests to cover target/template sets and binder-with-prediction grouping.
- Keep the current interaction tests as regression coverage for heatmap-to-viewer linking.

## Assumptions

- Frontend-only planning: no detailed FastAPI or SLURM contract is specified here, but the new state model should leave a clean seam for a later remote data source.
- Local file import remains supported and becomes one source of `StructureEntry` data rather than the defining architecture.
- Side-by-side connected comparison is the default comparison UX; overlay is a later enhancement.
- “Cropping” means defining and persisting a selected target subset plus cropped view behavior in the UI first, not performing backend structure editing yet.
- Current baseline is healthy enough to evolve incrementally: `npm test` passes on April 8, 2026.
