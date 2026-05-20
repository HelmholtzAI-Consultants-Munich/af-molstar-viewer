# AFDB-style Mol* Viewer

Prototype local-first, mostly vibe-coded web app for inspecting self-generated 
protein structure predictions just like in the AlphaFold database.

uses PDBe Mol*, adds an AlphaFold DB-style interactively linked pAE workspace.

![demo](demo.gif)

## Repo Layout

```text
af-molstar-viewer/
  frontend/  # React + Vite app
  backend/   # uv-managed FastAPI placeholder backend
  fixtures/  # shared example and test inputs
  docs/      # architecture and API notes
```

## Features

- load local prediction files directly in the browser
- PDBe Mol* viewer with light UI and AFDB-like illustrative cartoon rendering
- native Mol* sequence panel with pLDDT coloring
- linked pAE heatmap, sequence, and 3D structure interactions
- some content-based pairing of structure and JSON files, even when filenames do not match
- when folder import is ambiguous or missing, resolver gives clear errors
- structure-only loading for lone `.pdb` / `.cif` files that already contain pLDDTs
- if no real pAE is present, the app uses a placeholder pAE matrix
- examples included

## supported Inputs

The app currently understands:

- AlphaFold DB / AF2:
  - structure `.pdb`, `.cif`, or `.mmcif`
  - `predicted_aligned_error` JSON
- ColabFold:
  - structure `.pdb`
  - scores JSON with `plddt`, optional `pae`, `ptm`, and `iptm`
- Structure-only:
  - a lone `.pdb` / `.cif` / `.mmcif` with confidence values embedded in the structure

## Common Commands

From the repo root:

```bash
make help
make install
make dev-frontend
make dev-frontend-http
make dev-backend
make build
make test
```

## Frontend Setup

Install dependencies and run the dev server:

```bash
cd frontend
npm install
npm run dev
```


Production build:
```bash
cd frontend
npm run build
# run tests
npm test
# preview locally
npm run preview
```

## Backend Placeholder

The repo now also contains a fixture-backed FastAPI placeholder backend in [backend/pyproject.toml](/Users/leo.kaindl/python/dtand/af-molstar-viewer/backend/pyproject.toml) managed with `uv`.

Typical setup:

```bash
cd backend
uv sync
uv run backend
```

Frontend dev server with backend proxy:

```bash
cd frontend
VITE_PROJECT_API_MODE=http npm run dev
# in a second terminal
npm run dev:backend
```

Or from the repo root:

```bash
make dev-backend
make dev-frontend-http
```

## Future Plans

- This will become a part of the Web UI for a larger project around BindCraft.
- There will be a FastAPI server that manages SLURM jobs for BindCraft and ColabFold, and maybe does some light-weight pre- or post-processing and orchestration.
- The Web UI should gain functionality to:
  - [x] display the structure of the target protein / template pair
  - [x] enable selecting the interface, i.e. binding hotspots
  - [x] enable cropping that protein (via backend and API)
  - [ ] enable pLDDT/chain-id theme toggling for the target
  - [ ] use+show the pAE panel as a drawer on the right
  - [ ] show the generated binders
  - [ ] show the AF2-predicted structures of the binders
  - [ ] allow comparing the binders, maybe in separate connected views or with overlaying
  - [x] enable saving/exporting views from viewer panels as Mol* states (check)
  - [x] enable downloading structure files, and Mol* states = views. ideally separately.
  - [ ] low prio: drag structures onto **viewer** can load as well, not just target drop zone?
  - [ ] low prio: selection input field should go on the target card (hide the span that is there, but keep it around)


## Attribution

Reverse-engineered from the [AlphaFold database](https://alphafold.com/),
which is under a [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
creative commons license and developed by [Google DeepMind](https://deepmind.google/)
with [EMBL-EBI](https://www.ebi.ac.uk/).
