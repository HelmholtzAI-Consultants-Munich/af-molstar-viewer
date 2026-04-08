# AF Mol* Viewer + FastAPI Contract Plan

## Summary

Use `target` as the canonical design artifact and stop encoding `template` or `crop` as separate artifact kinds. A template is just one way to derive a `target`, and cropping is an operation that produces another `target`. The important distinction is provenance, not kind.

The frontend should evolve from a single loaded `PredictionBundle` into a project/workspace model with persisted artifacts, async jobs, and viewer sessions. Python/FastAPI should own all structure-changing operations, including template extraction and cropping, while the frontend owns selection, comparison, and job orchestration UX.

## Domain Model

### Canonical artifact kinds
Use:
- `target`
- `binder_candidate`
- `binder_validation`

Do not use `template` as an artifact kind. Do not use `crop_variant` as an artifact kind.

### Target provenance
A `target` should carry lineage metadata:
- `provenance = 'uploaded' | 'template_extracted' | 'cropped'`
- `parent_target_id?: string`
- `source_structure_id?: string`
- `source_job_id?: string`

This gives a clean model:
- direct uploaded target -> `target`
- template-derived target -> `target` with `provenance: 'template_extracted'`
- cropped target -> `target` with `provenance: 'cropped'`

### Target semantics
A `target` may contain one or more chains.
A `target_interface_residues` selection may span multiple chains, for example `A1-10,B20-22`.

### Template handling
Treat a template as an import/use-case, not a persistent artifact kind.
A template workflow is:
1. import a multichain structure
2. choose which chain(s) become the retained target
3. compute or reuse the interface residues against the dropped partner chain(s)
4. create a canonical `target` artifact
5. optionally crop that target later, producing another `target`

This keeps all downstream binder workflows targeting the same artifact family.

## FastAPI Contract

### Resource families
Use:
- `projects`
- `source_structures`
- `targets`
- `binder_runs`
- `binder_candidates`
- `validation_runs`
- `viewer_states`
- `jobs`

### Selections
Remove `SelectionKind`.
Use a single persisted field/model:
- `target_interface_residues`

Recommended representation:
- canonical string form for API payloads, e.g. `A1-10,B20-22`
- normalized structured form in responses if helpful:
  - chain ID
  - start residue
  - end residue

### Endpoints
Recommended contract:

- `POST /projects`
  - create a project

- `POST /projects/:projectId/import`
  - ingest uploaded files as source structures
  - may optionally create an initial `target` when the import is already a valid target

- `GET /projects/:projectId`
  - fetch project summary, active artifacts, and job summaries

- `GET /projects/:projectId/targets`
  - list all canonical target artifacts with provenance

- `POST /projects/:projectId/targets/from-template`
  - async operation
  - input: `source_structure_id`, retained chain(s), optional initial `target_interface_residues`
  - output: job ref
  - result: new `target`

- `POST /projects/:projectId/targets/:targetId/interface`
  - save/update `target_interface_residues`
  - input accepts multichain residue syntax like `A1-10,B20-22`

- `POST /projects/:projectId/targets/:targetId/crop`
  - async operation
  - input: crop definition plus optional label
  - output: job ref
  - result: new `target` with `provenance: 'cropped'`

- `POST /projects/:projectId/generate-binders`
  - async operation
  - input: `target_id`, `target_interface_residues`, run parameters
  - output: job ref
  - result: `binder_run` plus `binder_candidate` artifacts

- `POST /projects/:projectId/validate-refolding`
  - async operation
  - input: binder candidate IDs plus validation settings
  - output: job ref
  - result: `validation_run` plus `binder_validation` artifacts

- `GET /jobs/:jobId`
  - fetch status, timestamps, progress, errors, and produced artifact IDs

- `GET /projects/:projectId/viewer-states`
- `POST /projects/:projectId/viewer-states`

### Job types
Rename to:
- `import`
- `extract_target_from_template`
- `crop_target`
- `generate_binders`
- `validate_refolding`

Recommended statuses:
- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

Every async mutation should return:
- `job_id`
- `job_type`
- `status`

Successful jobs should return produced IDs such as:
- `target_ids`
- `binder_run_id`
- `binder_candidate_ids`
- `validation_run_id`
- `binder_validation_ids`

## Frontend Architecture

### State model
Replace the single active bundle model with:
- `WorkspaceProject`
- `TargetArtifact`
- `BinderRun`
- `BinderCandidate`
- `BinderValidation`
- `JobRef`
- `ViewerSession`
- `ViewerStateSnapshot`

Keep provenance on targets instead of separate artifact kinds.

### Viewer behavior
- side-by-side connected comparison remains the primary compare mode
- viewers compare persisted artifact IDs, not raw in-memory blobs
- saved Mol* states attach to artifact IDs
- transient hover/pin/brush state remains per viewer session

### Current code implications
- [App.tsx](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/app/App.tsx#L21) should become project/job/view composition, not the owner of all domain state
- [types.ts](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/lib/types.ts#L41) should be split into import-layer types vs project-domain types vs viewer-session types
- [MolstarPanel.tsx](/Users/leo.kaindl/python/dtand/af-molstar-viewer/src/components/MolstarPanel.tsx#L235) should become a thinner shell over a reusable viewer controller
- worker requests should gain request IDs so local parsing/import preview can support concurrent actions safely

## Placeholder Backend

Use a fixture-backed FastAPI, not a purely fake frontend mock.

Recommended approach:
- implement the real API surface in FastAPI now
- back it with hard-coded fixture manifests and existing example files
- keep async job endpoints real, but have them resolve to predefined outputs after a short artificial delay
- store fixture metadata in simple JSON manifests mapping:
  - source structures
  - derived targets
  - binder runs
  - validation runs
  - produced files

Why this is better than frontend-only mocking:
- it locks the contract early
- it exercises the real Python/FastAPI integration path
- it lets the frontend build polling, job history, and artifact refresh flows correctly
- later replacement with real BindCraft/ColabFold orchestration becomes an internal backend change

Recommended fixture modes:
- direct uploaded target
- template extraction -> target
- cropped target -> derived target
- generate binders -> binder candidates
- validate refolding -> validation artifacts

## Test Plan

- add reducer/state tests for target lineage and artifact replacement-free workflows
- add API-client tests for:
  - multichain `target_interface_residues`
  - template-to-target job flow
  - crop-to-new-target job flow
  - `generate_binders`
  - `validate_refolding`
- add UI tests for:
  - selecting multichain interface residues like `A1-10,B20-22`
  - starting crop and surfacing the resulting derived target
  - browsing binder candidates from a chosen target
  - comparing binder validations side by side
  - saving/restoring Mol* states per artifact
- keep current import and linked-view regression tests

## Assumptions

- cropping is always a backend operation and yields a new canonical `target`
- template extraction is also a backend-derived-target operation
- `target_interface_residues` is the only selection concept needed in this plan
- targets may contain multiple chains
- side-by-side connected comparison remains the default comparison mode
- a fixture-backed FastAPI is the preferred placeholder backend over frontend-only mocks
