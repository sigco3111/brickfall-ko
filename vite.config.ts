import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The recorded sounds aren't in this repo (MISSING_ASSETS.md). For each take `LAYERS` in src/audio.ts names whose
 * file isn't in public/audio, this serves (dev) and writes (build) a tenth of a second of silence, so the game asks
 * for nothing that's missing. With every file in place it does nothing, and the build is the release's.
 */
function silentStandIns(): Plugin {
  const missing = (): string[] => {
    const src = fs.readFileSync('src/audio.ts', 'utf8');
    const start = src.indexOf('export const LAYERS');
    const out: string[] = [];
    for (const [, name, takes] of src.slice(start, src.indexOf('};', start)).matchAll(/^\s+(\w+): (\d+),/gm))
      for (let k = 1; k <= Number(takes); k++)
        for (const ext of ['ogg', 'm4a']) if (!fs.existsSync(`public/audio/${name}_${k}.${ext}`)) out.push(`audio/${name}_${k}.${ext}`);
    return out;
  };
  const silence = (file: string) => fs.readFileSync(path.join('tools', `silence${path.extname(file)}`));
  return {
    name: 'silent-stand-ins',
    configureServer(server) {
      const list = new Set(missing());
      server.middlewares.use((req, res, next) => {
        const file = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!list.has(file)) return next();
        res.setHeader('content-type', file.endsWith('.ogg') ? 'audio/ogg' : 'audio/mp4');
        res.end(silence(file));
      });
    },
    generateBundle() {
      const list = missing();
      for (const file of list) this.emitFile({ type: 'asset', fileName: file, source: silence(file) });
      if (list.length) this.warn(`${list.length} sound files are missing, so the build has silence in their place (MISSING_ASSETS.md)`);
    },
  };
}

export default defineConfig({
  // Relative paths: the game is served from a folder of its own on Patch's game host
  base: './',
  resolve: { dedupe: ['three'] },
  plugins: [silentStandIns()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
});
