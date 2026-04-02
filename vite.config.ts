import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const pdbeLightScss = resolve(__dirname, 'node_modules/pdbe-molstar/lib/styles/pdbe-molstar-light.scss');
const molstarLightScss = resolve(__dirname, 'node_modules/molstar/lib/mol-plugin-ui/skin/light.scss');

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
});
