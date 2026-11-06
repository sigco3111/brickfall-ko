# Working on Brickfall

A first-person voxel demolition game on [Patch](https://patch.gg), in TypeScript on three.js (WebGPU), bundled by Vite. Start with `pnpm install`. What the person asks for comes first: nothing here says what to make.

## Missing sounds

The release's recorded sound effects aren't in this repo: their licence allows them inside the game but not in a repo. `public/audio/` holds only the generated horn, whistle and music. For each missing take, `vite.config.ts` serves and builds a tenth of a second of silence (`tools/silence.*`), so the game builds, runs and passes `pch check` as it is, but blasts and impacts sound thin. A file you put in `public/audio/` replaces its stand-in. [MISSING_ASSETS.md](MISSING_ASSETS.md) lists every file, its original source and licence, and how to drop sounds in. `node tools/open-sounds.mjs <clone of patch/voxel-destruction>` fills 67 of the 86 recorded names with open sounds. Never commit sounds whose licence bars passing them on.

## Run

- `pnpm dev`: Vite on http://127.0.0.1:5320.
- `pnpm build`: makes `dist/`, which is the whole release (everything in `public/` ships as it is).
- URL flags (`src/main.ts`, `src/boot.ts`): `?patch-test=1` (Patch's runner: plays the first contract by itself and prints `pass <name>` lines), `?test` (no intro or locks, for scripts), `?seed=`, `?hour=`, `?retune` (measure the GPU again), `?locks`, `?noao`, `?nocam`, `?nogpu` (the needs-WebGPU screen).

## Check

| Command | What it checks |
| --- | --- |
| `pch check` (after a build) | Patch's own look at the game, as its host serves it |
| `pch validate` | `patch.json`, its recipe and its files |
| `pnpm typecheck` | Types |
| `pnpm test` | Node tests: hardness tiers, the structure and load model |
| `pnpm test:gpu` | The city's physics headless through Dawn (`webgpu` package; needs a GPU) |
| `pnpm bench` | Main-thread cost of a blast and the debris readback, headless |

Browser scripts you add should run muted and must not take the real mouse: launch Chromium with `--mute-audio` and fake `requestPointerLock`.

## Change

- `public/CREDITS.md`, `public/LICENSE` and `public/patch-credits.js` ship in the game and describe the release, including its sounds. Change them with the sounds you add.
- New sounds go in `public/audio/` as `<name>_<take>.ogg` and `.m4a`; `LAYERS` in `src/audio.ts` says how many takes each layer has, and `TRIM` beside it holds per-take level fixes. Anything you commit has to be open enough to ship in a repo anyone can fork: CC0 or CC-BY, credited.
- Materials have hardness tiers (`src/world.ts`) and the radii each tool breaks them to (`RADII` in `src/destruction.ts`). `tests/hardness.test.ts` holds them in place.
- `VEHICLES` in `src/machines.ts` is false: the crane and excavator are built but parked in this release.
- To publish: put the next version in `patch.json`, commit, then `pch publish`, which says what comes next. A fork's `patch.json` has to name the fork.

## Where things live

| Path | What |
| --- | --- |
| `src/main.ts` | The game: modes, contracts, tools, scoring and combos, fire, the replay camera, the `?patch-test=1` run |
| `src/levels.ts`, `src/world.ts`, `src/suburb.ts`, `src/skyline.ts` | The eleven lots, voxel materials and builders, the streets around them |
| `src/physics.ts`, `src/destruction.ts`, `src/structure.ts` | GPU rigid bodies (three-avbd), blasts and breaks, what holds what up |
| `src/render.ts`, `src/look.ts`, `src/sky.ts`, `src/particles.ts`, `src/water.ts` | Rendering, light and char, the sky, smoke and fire, the sea |
| `src/machines.ts`, `src/rigging.ts` | The parked machines; planks and cables |
| `src/audio.ts` | Sound: recorded layers by name, synthesis, the mix |
| `src/hud.ts`, `src/replay.ts`, `src/calibrate.ts`, `src/boot.ts` | Screens, replays, GPU tuning, the WebGPU check |
| `tools/audio-build/` | Rebuilds the original sound cuts from the Sonniss bundles (see MISSING_ASSETS.md) |
| `tools/open-sounds.mjs` | Fills missing takes from Patch's open voxel destruction block |
| `tools/silence.ogg`, `.m4a` | The stand-in for each missing take (`vite.config.ts`) |
| `tests/`, `tests-gpu/`, `scripts/` | Node tests, GPU tests, the bench and the sky's sun finder |
