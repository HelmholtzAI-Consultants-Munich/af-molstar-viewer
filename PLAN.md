# AF Mol* Viewer + FastAPI Contract Plan

## Summary

The current app is a strong single-prediction prototype, but its main state model is still centered on one loaded `PredictionBundle` and one active workspace. That is the main architectural mismatch with the README roadmap: target/template pairs, crop artifacts, generated binders, AF2 binder predictions, compare sessions, and saved Mol* views all need to coexist in one persistent project/workspace model instead of replacing each other.

The plan should therefore shift from “extend the viewer” to “introduce a project/workspace domain with backend-backed artifacts and jobs.” Cropping and binder generation should be modeled as asynchronous FastAPI operations that produce new persisted artifacts, not as frontend-only transforms.

## Key Changes

### 1. Introduce a backend-backed workspace/project model
- Replace the frontend’s conceptual center from a single loaded prediction to a `WorkspaceProject`.
- The project should own:
  - source structures: target, template, binder, binder prediction
  - derived artifacts: cropped target variants, generated binder sets, AF2 prediction results
  - saved residue selections: hotspots and interface selections
  - viewer state snapshots: saved Mol* states
  - comparison sessions
  - job references and job history
- Keep local file import as an ingestion mode, but treat imported files as the way a project gets seeded, not as the permanent app architecture.

### 2. Clarify the FastAPI contract now
Use an async job model for anything that may touch Python orchestration or SLURM.

Recommended backend resource families:
- `projects`
- `structures`
- `selections`
- `crop_variants`
- `binder_runs`
- `binder_candidates`
- `prediction_runs`
- `viewer_states`
- `jobs`

Recommended contract shape:
- `POST /projects`
  - create a project
- `POST /projects/:projectId/import`
  - ingest uploaded structure/score/PAE files into canonical backend structures
- `GET /projects/:projectId`
  - fetch the project with artifact summaries
- `GET /projects/:projectId/structures`
  - list target/template/binder-related structures and derived variants
- `POST /projects/:projectId/selections`
  - save a named hotspot/interface selection against a structure or crop variant
- `POST /projects/:projectId/crops`
  - start crop creation as an async job
  - input: source target structure ID, crop definition, optional label
  - output: job reference
- `POST /projects/:projectId/binder-runs`
  - start binder generation as an async job
  - input: chosen target or crop variant ID, selection IDs, run parameters
  - output: job reference
- `POST /projects/:projectId/prediction-runs`
  - start AF2/ColabFold prediction for selected binders as an async job
  - input: binder candidate IDs plus prediction settings
  - output: job reference
- `GET /jobs/:jobId`
  - fetch status, progress, timestamps, and produced artifact IDs
- `GET /projects/:projectId/viewer-states`
- `POST /projects/:projectId/viewer-states`

Job payload expectations:
- every async mutation returns `jobId`, `jobType`, `status`
- job status includes `queued | running | succeeded | failed | cancelled`
- successful jobs include produced artifact IDs
- failed jobs include a user-displayable message plus backend detail for debugging

### 3. Define artifact semantics clearly
- Cropping produces a new persisted `crop_variant`, never an in-place overwrite.
- Binder generation consumes:
  - a target structure ID or crop variant ID
  - saved hotspot/interface selection IDs
  - run parameters
- Generated binders become backend artifacts grouped under a `binder_run`.
- AF2-predicted binder structures are produced by a separate prediction run and linked back to binder candidates.
- Viewer compare sessions should compare persisted artifacts, not transient local blobs.

### 4. Reorganize the frontend around project state and viewer state
- Keep `App` as the root composition layer, but move toward a project reducer/store with separate slices for:
  - project/artifact data
  - job status
  - viewer sessions
  - transient hover/pin/brush interactions
- Replace the current single active `bundle` model with artifact-aware entities:
  - `StructureArtifact`
  - `CropVariant`
  - `BinderRun`
  - `BinderCandidate`
  - `PredictionRun`
  - `ViewerSession`
- Keep the worker/import code, but constrain it to local parsing and preview/import preparation.
- Introduce request IDs for worker messages so frontend local parsing can safely support concurrent actions.

### 5. Make side-by-side comparison the first-class viewer mode
- Primary comparison UX is connected side-by-side viewers.
- A comparison session should reference artifact IDs, not raw structure text.
- Shared capabilities:
  - linked residue selection
  - optional camera sync
  - synchronized saved-view restore
- Overlay can remain a later extension once artifact identity and comparison sessions are stable.

## Public Interfaces / Types

Add frontend domain types:
- `WorkspaceProject`
- `ProjectArtifactRef`
- `StructureArtifact`
- `CropVariantArtifact`
- `SavedSelection`
- `BinderRun`
- `BinderCandidate`
- `PredictionRun`
- `JobRef`
- `JobStatus`
- `ViewerStateSnapshot`
- `ComparisonSession`

Key enums:
- `ArtifactKind = 'target' | 'template' | 'crop_variant' | 'binder_candidate' | 'binder_prediction'`
- `SelectionKind = 'hotspot' | 'interface'`
- `JobType = 'import' | 'crop' | 'binder_generation' | 'binder_prediction'`
- `JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'`

Important defaults:
- crop requests create new artifacts
- binder generation consumes saved selections plus a selected crop variant or source target
- long-running Python work is always async

## Test Plan

- Add frontend state tests for project/artifact/job reducers.
- Add API-client tests for job polling and artifact refresh after successful jobs.
- Add UI tests for:
  - saving hotspot/interface selections
  - starting a crop job and surfacing its result as a new target variant
  - starting a binder generation job from a chosen crop variant
  - browsing binder candidates and opening compare sessions
  - saving and restoring Mol* viewer states against persisted artifact IDs
- Keep current import and interaction tests as regression coverage for the local-first viewer path.

## Assumptions

- Cropping is a real Python/backend operation, not a frontend-only view transform.
- Binder generation is backend-orchestrated and may be SLURM-backed.
- FastAPI should own canonical artifact identity once a project exists.
- The frontend may still support pure local preview/import, but the main long-term architecture should assume persisted project data and async jobs.
- Side-by-side connected comparison remains the default comparison mode.
