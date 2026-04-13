import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const repoRoot = resolve(__dirname, '..');

function resolveDependencyFile(relativePath: string): string {
  const localPath = resolve(__dirname, 'node_modules', relativePath);
  if (existsSync(localPath)) return localPath;
  return resolve(repoRoot, 'node_modules', relativePath);
}

const pdbeLightScss = resolveDependencyFile('pdbe-molstar/lib/styles/pdbe-molstar-light.scss');
const molstarLightScss = resolveDependencyFile('molstar/lib/mol-plugin-ui/skin/light.scss');

export default defineConfig({
  plugins: [
    {
      name: 'force-molstar-light-skin',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('pdbe-molstar-dark.scss')) {
          return pdbeLightScss;
        }
        if (source.endsWith('mol-plugin-ui/skin/dark.scss') || source.endsWith('/skin/dark.scss')) {
          return molstarLightScss;
        }
        return null;
      },
    },
    react(),
  ],
  server: {
    fs: {
      allow: [
        repoRoot,
        resolve(repoRoot, 'fixtures'),
        resolve(repoRoot, 'node_modules'),
      ],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/fixture-files': 'http://127.0.0.1:8000',
    },
  },
});
