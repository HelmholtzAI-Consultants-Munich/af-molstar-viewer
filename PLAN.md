# Mol* AlphaFold Viewer Plan

**Summary**
- Build a local-first, static-hostable web app in React + TypeScript + Vite that loads AlphaFold/ColabFold/AlphaFold3 output files directly in the browser.
- Use `pdbe-molstar` as the 3D viewer wrapper, with `alphafoldView` enabled, because it is the Mol* integration used by AlphaFold DB and already exposes AlphaFold-style confidence coloring plus programmatic selection/highlight hooks.
- Recreate the classic AlphaFold DB workspace: sequence strip on top, PAE heatmap bottom-left, Mol* viewer center, confidence legend/right panel, with tightly linked hover, click, brush, and zoom interactions.

**Implementation Changes**
- App shell:
  - Add a top-level workspace with file import, example-loader, prediction chooser, and a persisted “current bundle” state.
  - Support drag-and-drop, multi-file pick, and folder pick when the File System Access API is available.
- Normalization layer:
  - Define `PredictionBundle`, `PredictionAdapter`, `PolymerIndex`, and `SelectionState` types.
  - Implement adapters for:
    - AF2/AFDB-style files: structure `.cif` or `.pdb` plus `predicted_aligned_error` JSON array.
    - ColabFold: matched structure file plus `scores.json`-style output containing `plddt`, optional `pae`, `max_pae`, `ptm`, `iptm`.
    - AF3: `<job>_model.cif` plus `<job>_confidences.json` and optional summary JSON.
  - Normalize all inputs to:
    - polymer sequence tracks by chain
    - displayed PAE matrix
    - per-residue confidence bins for coloring/legend
    - chain and residue lookup tables for Mol* synchronization
  - AF3 v1 rule: display only protein/RNA/DNA polymer tokens in the 2D confidence workspace; keep ligands/PTMs visible in 3D but exclude ligand-only confidence semantics from the PAE/sequence UI.
- PAE + sequence workspace:
  - Render the PAE matrix with a canvas heatmap plus lightweight SVG/canvas overlays for axes, diagonal, hover crosshair, brush rectangle, and zoom window.
  - Render the sequence strip as a scalable residue track colored by confidence bins matching AlphaFold DB.
  - Interaction contract:
    - sequence hover highlights the residue in Mol*, shows row/column guides in PAE
    - PAE hover highlights the corresponding residue pair/ranges in Mol*
    - click on a residue or PAE cell locks selection
    - brush on the PAE heatmap selects a submatrix and focuses the corresponding sequence ranges and structure regions
    - reset/clear restores the full matrix and viewer
- Mol* integration:
  - Load local structures into `pdbe-molstar` through object URLs and `customData`.
  - Use viewer APIs for highlight, selection, focus, sequence coloring, and reset rather than building custom 3D logic.
  - Keep default coloring on pLDDT/confidence; expose a minimal right-panel legend matching AlphaFold DB’s four confidence bins.
  - Subscribe to Mol* hover/selection events so direct 3D interaction also updates the sequence and PAE state.
- File discovery and matching:
  - Group files by basename/job stem and validate required pairs before enabling a prediction.
  - Show a resolver UI when multiple candidate JSONs or structures match one job.
  - Run JSON parsing and matrix preprocessing in a web worker to avoid blocking on large AF3/ColabFold outputs.

**Public Interfaces / Types**
- `PredictionAdapter`:
  - `canLoad(files): boolean`
  - `load(files): Promise<PredictionBundle>`
- `PredictionBundle`:
  - structure source
  - chains and polymer residue/token index
  - normalized displayed PAE matrix
  - confidence track
  - summary metrics
  - source metadata
- `SelectionState`:
  - hovered residue/range
  - hovered PAE cell/window
  - pinned selection
  - current PAE viewport

**Test Plan**
- Unit tests for each adapter with fixtures for:
  - AFDB/AF2 example files already in the repo
  - one ColabFold monomer/multimer fixture
  - one AF3 polymer-containing fixture
- Interaction tests for:
  - sequence-to-PAE-to-Mol* hover sync
  - brush selection and reset
  - file grouping and ambiguous-match handling
  - AF3 polymer-only projection behavior
- Browser smoke tests for:
  - loading local files without a backend
  - rendering a 600+ residue PAE matrix
  - preserving responsiveness during worker-based parsing

**Assumptions / Defaults**
- v1 is single-user and client-only; no auth, database, uploads API, or shareable server-side jobs.
- The UI matches the classic screenshot layout rather than the newer AFDB page shell.
- AF3 support in v1 is protein/nucleic-acid first; ligand/PTM-specific confidence visualization is explicitly deferred.
- `pdbe-molstar` is the primary viewer dependency; raw `molstar` is only used indirectly unless a missing hook forces a small extension layer.
