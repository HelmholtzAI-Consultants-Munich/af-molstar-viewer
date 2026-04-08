# AFDB-style Mol* Viewer

Prototype local-first _all-vibe-coded_ web app for inspecting self-generated protein structure predictions just like in the AlphaFold database.  

uses PDBe Mol*, adds an AlphaFold DB-style interactively linked pAE workspace.

> [!NOTE] Future plans
> - This will become a part of the Web UI for a larger project around BindCraft.
> - There will be a FastAPI server that manages SLURM jobs for BindCraft and ColabFold, and maybe does some light-weight pre-or post-processing and orchestration.
> - The Web UI should gain functionality to:
>   - display the structure of the target protein / template pair
>   - enable selecting the interface, i.e. binding hotspots
>   - enable cropping that protein
>   - show the generated binders
>   - show the AF2-predicted structures of the binders
>   - allow comparing the binders, maybe in separate connected views or with overlaying
>   - enable saving/exporting views from viewer panels as Mol* states

### TODO
- ask codex to evaluate architecture for this purpose
- design choice: Mol* `Focus` should only ever be `target`, and not include `surroundings`

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
npm run dev
# in a second terminal
npm run dev:backend
```

Or from the repo root:

```bash
make dev-frontend
make dev-backend
```
