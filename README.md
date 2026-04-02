# AF Mol* Viewer

Local-first web app for visualizing AlphaFold2, ColabFold, and AlphaFold3 predictions with Mol* and an AlphaFold DB-style PAE workspace.

## What This Repo Should Track

Track these files and folders:

- `src/`
- `example/`
- `index.html`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.node.json`
- `vite.config.ts`
- `vitest.config.ts`
- `README.md`
- `.gitignore`

Do not track generated or machine-local artifacts:

- `node_modules/`
- `dist/`
- `*.tsbuildinfo`
- generated config outputs like `vite.config.js`, `vite.config.d.ts`, `vitest.config.js`, `vitest.config.d.ts`
- local `.env*` overrides
- OS/editor files like `.DS_Store` and swap files

Why:

- source, config, lockfiles, and example fixtures make the app reproducible
- dependencies and build output can be recreated from the lockfile
- incremental caches and generated JS typings are local build artifacts

## Requirements

- Node.js 18+ recommended
- npm

## Setup

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Build the production bundle:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Preview the production build locally:

```bash
npm run preview
```

## Using The App

The app supports:

- AlphaFold DB / AF2-style structure files with `predicted_aligned_error` JSON
- ColabFold outputs with `scores.json`-style confidence data
- AlphaFold3 outputs with `*_model.cif` and `*_confidences.json`

You can:

- drag and drop files into the app
- load the bundled example files from `example/`
- inspect structures in Mol*
- use the PAE panel to brush-select residue blocks
- see linked structure and sequence coloring

## Notes

- The viewer is client-side and static-hostable.
- Large Mol* bundles are expected during production builds.
- The app currently uses PDBe Mol* with a light UI skin and a cartoon-based illustrative style tuned to resemble AlphaFold DB.
