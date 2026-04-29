# Mol* Session-Based Viewer State Plan

## Summary

The current implementation only persists a thin slice of viewer state: `selection` as semantic selection text, plus focus as residue indices. That is why switching back to a target does not fully restore Mol* `Focus`, camera, or orientation. The Mol* “Session” feature is the right way forward here: it captures the real plugin/viewer state, not just residue lists.

The plan is to keep semantic project state and Mol* viewer state as two separate layers:

- semantic state stays explicit in the app/domain model
  - `selection` remains a target-owned field and stays linked to Mol* `selection`
- viewer state moves to Mol* snapshots/sessions
  - one persisted viewer snapshot per artifact per viewer configuration
  - this restores focus, orientation, camera, and other Mol*-native state

## Key Changes

### 1. Replace residue-only focus persistence with Mol* session snapshots
Use the underlying Mol* snapshot/session manager exposed through the PDBe Mol* plugin instance, rather than reconstructing focus from residue arrays.

Recommended approach:
- capture a JSON Mol* snapshot payload for the active artifact/viewer
- restore that snapshot when switching back to the same artifact
- store snapshots in the existing `viewer_states` project collection
- scope each snapshot to both:
  - `artifact_id`
  - `viewer_configuration`

This is the closest match to the “Session” behavior on molstar.org/viewer, and it is the only approach that will reliably restore:
- focus target
- camera/orientation
- view state
- selection state, when desired

### 2. Split semantic state from viewer state
Keep these separate on purpose:

Semantic project state:
- `selection`
- target provenance and identity
- pipeline-stage metadata

Mol* viewer state:
- camera/orientation
- focus
- Mol* selection internals
- representation/viewer settings
- other session-level plugin state

Decision:
- `selection` remains the source of truth for the domain
- Mol* snapshot is the source of truth for viewer restoration
- the input field should continue to drive Mol* `selection`
- snapshot restore should not overwrite the saved semantic interface string with unrelated transient viewer state

### 3. Introduce stage-specific viewer configurations
The app should stop treating all viewers as one configuration.

Define at least:
- `target`
- `validate_refolding`

Recommended behavior:
- `target` viewer configuration:
  - no AlphaFold-DB-style PAE panel
  - optimized for target inspection, target-local interface selection, and target-local focus/session restore
- `validate_refolding` viewer configuration:
  - includes the AFDB-style PAE-linked workspace
  - snapshot payload may be combined with extra stage UI state such as pinned pair/brush/PAE panel state

This keeps the current early PAE implementation from hard-defining the long-term `target` experience.

### 4. Define restore behavior precisely
For the `target` stage, switching back to `target_alpha` should restore the last viewer session for that target automatically.

Recommended restore order:
1. load artifact structure
2. apply baseline viewer configuration for the stage
3. restore latest saved Mol* snapshot for that `artifact_id + viewer_configuration`
4. re-enforce invariants that must always hold for this app

Important invariant:
- Mol* `Focus` should always use `target` only, never `surroundings`

That invariant should be applied both:
- on fresh viewer initialization
- after snapshot restore

### 5. Tighten save triggers
Do not save snapshots on every tiny viewer event. Use controlled auto-save points.

Recommended save triggers for `target` stage:
- after a completed focus change
- after camera/orientation settles
- after selection changes, if selection mode is active
- on target switch / viewer unmount as a final flush

Use debounced persistence so the app does not thrash state while the user is actively moving the camera.

## Public Interfaces / Types

Extend the existing viewer-state model rather than inventing a second one.

Recommended additions:
- `ViewerConfiguration = 'target' | 'validate_refolding'`
- `ViewerStateSnapshot`
  - `artifact_id`
  - `viewer_configuration`
  - `label?`
  - `payload` as Mol* snapshot/session JSON
  - `updated_at`
- keep `selection` on the target artifact/project state

Recommended rule:
- residue-array `focusedResidues` should stop being the primary persistence mechanism
- if kept at all, it should only be a derived UI convenience, not the restoration source

## Test Plan

Add tests for these scenarios:

- switching from `target_alpha` to `target_beta` and back restores:
  - focus
  - camera/orientation
  - target-only focus mode
- `selection` stays target-local and still drives Mol* selection
- turning Mol* selection mode off does not erase the input
- turning selection mode back on re-applies the input-driven selection
- restoring a snapshot for `target` does not accidentally enable `surroundings`
- `validate_refolding` uses a different viewer configuration from `target`
- viewer states are keyed by both artifact and stage, so a `target` snapshot is not reused for `validate_refolding`

## Assumptions And Defaults

- the Mol* variant currently in use can access the underlying snapshot/session manager through the PDBe wrapper, so Mol* “Session”-style persistence is feasible
- automatic per-target restore is the default behavior for the `target` stage
- `selection` remains a semantic project field and should not be replaced by raw Mol* snapshot data
- the current AFDB-style PAE workspace should be treated as an early `validate_refolding` viewer, not the long-term default `target` viewer
- the first implementation should store JSON snapshot payloads in app/backend state; downloadable/importable `.molj` compatibility can come after that
