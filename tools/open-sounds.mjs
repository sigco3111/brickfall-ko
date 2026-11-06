// Fills the sound takes missing from public/audio with open ones of the same name from a clone of Patch's
// voxel destruction block (CC0 and CC-BY recordings), and lists what's still missing. It never overwrites a file.
//   git clone https://git-staging.patch.gg/patch/voxel-destruction.git ../voxel-destruction
//   node tools/open-sounds.mjs ../voxel-destruction
// Then copy the credit lines of what it copied from the block's CREDITS.txt into CREDITS.md, public/CREDITS.md and
// public/patch-credits.js: some of those recordings are CC-BY, which asks for credit.
import fs from 'node:fs';
import path from 'node:path';

const block = process.argv[2];
if (!block) throw new Error('usage: node tools/open-sounds.mjs <clone of patch/voxel-destruction>');
const from = path.join(block, 'public', 'audio');
const to = path.resolve('public', 'audio');
const src = fs.readFileSync(path.resolve('src', 'audio.ts'), 'utf8');
const layers = src.slice(src.indexOf('export const LAYERS'), src.indexOf('};', src.indexOf('export const LAYERS')));
const copied = [], missing = [];
for (const [, name, takes] of layers.matchAll(/^\s+(\w+): (\d+),/gm)) {
  for (let k = 1; k <= Number(takes); k++) {
    for (const ext of ['ogg', 'm4a']) {
      const file = `${name}_${k}.${ext}`;
      if (fs.existsSync(path.join(to, file))) continue;
      if (fs.existsSync(path.join(from, file))) {
        fs.copyFileSync(path.join(from, file), path.join(to, file));
        copied.push(file);
      } else missing.push(file);
    }
  }
}
console.log(`copied ${copied.length} files from ${from}`);
if (copied.length) console.log(' ', copied.join(' '));
console.log(`still missing ${missing.length} (the build puts silence in their place; MISSING_ASSETS.md says where to find them)`);
if (missing.length) console.log(' ', missing.join(' '));
