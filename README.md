---
kind: game
engine: three.js
---

# Brickfall

A short first-person demolition game. Each contract is one small lot and a clock: knock out what holds a building up and watch the storeys come down, brick by brick. Every voxel is a real rigid body, simulated on your graphics card, so walls crack along their seams, falling sections shatter where they land and the rubble stays where it settles.

Four modes (Rush, Blowdown, Salvage and Sandbox), eleven lots from a starter home to an eleven-storey tower, a sea pier and a church steeple, and tools from a sledge and a hand cannon to cutter charges, a jackhammer, rockets, pipe bombs and planks.

On Patch as `blendi/brickfall`. Built on [three-voxel-destruction](https://github.com/sbobyn/three-voxel-destruction) by Steven Bobyn (MIT), which does the voxel physics, destruction, structure, rendering and dust.

## Missing sounds

**This repo has none of the release's recorded sound effects.** Its 86 recorded sounds are licensed for the game only, so they can't be passed on in a repo. The game runs without them: the build puts a moment of silence in place of each missing file, and the synthesised layers and the music still play. [MISSING_ASSETS.md](MISSING_ASSETS.md) lists every one: what it is, where the original came from, its licence, and how to drop a sound in. One command fills 67 of them with open sounds of the same names from Patch's voxel destruction block.

## How it's built

A browser game in TypeScript on [three.js](https://threejs.org) (WebGPU), bundled by Vite into a folder of static files. There are no models: the lots, buildings, props, tools and the heist's truck are built from voxels and boxes in code. Physics runs on the GPU in [three-avbd](https://github.com/sbobyn/three-avbd), Steven Bobyn's rigid-body solver. The art files are Poly Haven textures and skies (CC0), two fonts (OFL), and the generated music bed, horn and whistle.

## Run it

It takes Node 22 or newer, pnpm 10, and a browser with WebGPU (Chrome or Edge 113+, Safari 26, or Firefox 141+ on Windows).

```sh
pnpm install
pnpm dev          # http://127.0.0.1:5320
pnpm build        # makes dist/, the game as Patch serves it
```

Controls: WASD move, mouse look (click to capture, Esc to pause), left click use the tool, 1 to 8 or the wheel switch tools, right click or Q blow the charges, R set a charge's delay, L the load view, Space jump, Shift sprint, C crouch, F take the loot (Salvage). In the Sandbox, B spawns props and T sets the time of day.

A controller works too (standard mapping; the words on screen follow it, with Xbox or PlayStation names): left stick to move, right stick to look, RT to use the tool (hold it for the sledge and the jackhammer), LT or Y to blow the charges, LB and RB to change tools (hold one for the tool wheel: the right stick picks, let go to take it), the D-pad's left and right too, down for a charge's delay, up for the load view, X to take the loot, A to jump, B to crouch, a left-stick click to sprint, Start to pause. A or B skips the intro and the replay. In the Sandbox, View opens the spawn bar (D-pad to pick, A to spawn, B to close) and a right-stick click sets the time of day. On the menus the D-pad or left stick moves, A presses, B goes back and left/right moves a slider or a list. The pause card has stick sensitivity and deadzone. Unplugging the pad mid-job pauses. The pad code is `src/pad.ts`, the same file as Siege's.

`AGENTS.md` says how to check and change it, and where things live.

## Licence

The code is MIT ([LICENSE](LICENSE)): Steven Bobyn's engine and Patch's game on top. Textures and skies are CC0 (Poly Haven), the fonts OFL 1.1, three.js and three-avbd MIT, with their texts in [public/LICENSES/](public/LICENSES). The music bed, horn and whistle were generated for this game. [CREDITS.md](CREDITS.md) has the details. Sounds you add keep their own licences.
