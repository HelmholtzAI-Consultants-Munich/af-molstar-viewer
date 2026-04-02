# AFDB-style Mol* Viewer

Prototype local-first _all-vibe-coded_ web app for inspecting self-generated protein structure predictions just like in the AlphaFold database.  

uses PDBe Mol*, adds an AlphaFold DB-style interactively linked pAE workspace.

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

## setup

install dependencies and run the dev server

```bash
npm install
npm run dev
```


production build:
```bash
npm run build
# run tests
npm test
# preview locally
npm run preview
```
