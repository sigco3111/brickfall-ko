// Brickfall's screens: the title with the three contracts, the in-game HUD (clock, score and
// combo, the job's demolition bar with its star marks, the tools, popups and banners), the pause
// menu with settings, and the end-of-contract card. Plain DOM over the canvas.

import '@fontsource/anton/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';

export interface Tool {
  name: string;
  key: string;
  hint: string;
  icon: string;
}

export interface Settings {
  sensitivity: number;
  fov: number;
  invertY: boolean;
  quality: 'low' | 'medium' | 'high';
  graphics: 'auto' | 'low' | 'medium' | 'high';
  volume: number;
  music: number;
  shake: boolean;
  hour: number;
  smoothing: boolean;
  dof: boolean;
  sunRays: boolean;
}

export interface ContractCard {
  id: number;
  name: string;
  brief: string;
  best: number;
  stars: number;
  /** Still locked: how many stars open it. */
  locked?: number;
}

export interface EndResult {
  title: string;
  sub: string;
  stars: number;
  rows: [string, string][];
  score: number;
  best: boolean;
  hasNext: boolean;
  /** The best moment, recorded (a video URL and what it was), to watch again. */
  replay?: { url: string; label: string } | null;
}

const CSS = `
:root { --cream: #f3efe6; --amber: #ffb347; --mustard: #d3a136; --brick: #c8392b; --teal: #2f7f86; --ink: rgba(14,15,19,0.72); }
body { font-family: 'Inter', system-ui, sans-serif; }
.d { font-family: 'Anton', Impact, 'Arial Black', sans-serif; font-weight: 400; letter-spacing: 0.02em; text-transform: uppercase; }
.hud { position: fixed; inset: 0; z-index: 1; pointer-events: none; user-select: none; color: var(--cream); transition: opacity 300ms; }
.hud.off { opacity: 0; }
.hud .cross { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; transform: translate(-50%, -50%); }
.hud .cross i { position: absolute; background: rgba(255,255,255,0.92); box-shadow: 0 0 2px rgba(0,0,0,0.9); border-radius: 1px; transition: background 120ms, transform 120ms; }
.hud .cross i:nth-child(1) { left: 12px; top: 0; width: 2px; height: 8px; }
.hud .cross i:nth-child(2) { left: 12px; bottom: 0; width: 2px; height: 8px; }
.hud .cross i:nth-child(3) { top: 12px; left: 0; height: 2px; width: 8px; }
.hud .cross i:nth-child(4) { top: 12px; right: 0; height: 2px; width: 8px; }
.hud .cross.hit i { background: var(--amber); }
.hud .cross.kick { animation: kick 220ms ease-out; }
@keyframes kick { 0% { transform: translate(-50%,-50%) scale(1.7); } 100% { transform: translate(-50%,-50%) scale(1); } }
.hud .ring { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; transform: translate(-50%, -50%); opacity: 0; transition: opacity 120ms; }
.hud .ring circle { fill: none; stroke: var(--amber); stroke-width: 3; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; filter: drop-shadow(0 0 3px rgba(0,0,0,0.8)); }
.hud .ring.on { opacity: 1; }
.hud .clock { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); text-align: center; text-shadow: 0 2px 10px rgba(0,0,0,0.6); }
.hud .clock .t { font-size: 46px; line-height: 1; }
.hud .clock .l { font: 700 10px/1 Inter, sans-serif; letter-spacing: 0.22em; opacity: 0.7; margin-top: 4px; }
.hud .clock.low .t { color: #ff6a4d; animation: throb 0.5s ease-in-out infinite alternate; }
@keyframes throb { to { transform: scale(1.08); } }
.hud .scorebox { position: absolute; right: 22px; top: 16px; text-align: right; text-shadow: 0 2px 10px rgba(0,0,0,0.6); }
.hud .score { font-size: 42px; line-height: 1; font-variant-numeric: tabular-nums; transition: transform 90ms; }
.hud .score.bump { transform: scale(1.08); color: #fff3d6; }
.hud .combo { margin-top: 6px; display: inline-flex; align-items: center; gap: 8px; opacity: 0; transform: translateY(-4px); transition: opacity 150ms, transform 150ms; }
.hud .combo.on { opacity: 1; transform: none; }
.hud .combo .x { font-size: 30px; line-height: 1; color: var(--amber); }
.hud .combo .bar { width: 90px; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.15); overflow: hidden; }
.hud .combo .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--brick), var(--amber)); }
.hud .combo.hot .x { color: #ff7a3d; animation: throb 0.25s ease-in-out infinite alternate; }
.hud .job { position: absolute; left: 22px; top: 18px; width: 280px; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }
.hud .job .n { font-size: 20px; line-height: 1; }
.hud .job .b { font: 600 12px/1.3 Inter, sans-serif; opacity: 0.8; margin: 4px 0 8px; }
.hud .job .meter { position: relative; height: 12px; border-radius: 6px; background: rgba(10,11,14,0.55); border: 1px solid rgba(255,255,255,0.18); overflow: visible; }
.hud .job .meter > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; background: linear-gradient(90deg, #b8432f, var(--amber)); transition: width 250ms ease-out; }
.hud .job .meter .tick { position: absolute; top: -5px; width: 2px; height: 20px; background: rgba(255,255,255,0.5); }
.hud .job .meter .star { position: absolute; top: -21px; transform: translateX(-50%); font-size: 13px; color: rgba(255,255,255,0.35); transition: color 200ms, transform 200ms; }
.hud .job .meter .star.got { color: var(--amber); transform: translateX(-50%) scale(1.35); }
.hud .job .pct { margin-top: 6px; font: 800 13px/1 Inter, sans-serif; letter-spacing: 0.04em; }
.hud .job .keep { margin-top: 6px; font: 600 12px/1.3 Inter, sans-serif; opacity: 0.85; }
.hud .job .keep.lost { color: #ff7a5c; }
.hud .job .load { margin-top: 6px; font: 800 11px/1 Inter, sans-serif; letter-spacing: 0.14em; display: none; align-items: center; gap: 8px; }
.hud .job .load.on { display: flex; }
.hud .job .load i { display: block; width: 70px; height: 5px; background: rgba(255,255,255,0.18); position: relative; overflow: hidden; }
.hud .job .load i b { position: absolute; inset: 0 auto 0 0; background: var(--amber); }
.hud .job .load.red { color: #ff6a4c; }
.hud .job .load.red i b { background: #ff4a2c; animation: loadpulse 0.5s ease-in-out infinite alternate; }
@keyframes loadpulse { from { opacity: 0.6; } to { opacity: 1; } }
.hud .tools { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; gap: 10px; }
.hud .slot { position: relative; width: 78px; padding: 10px 6px 8px; border-radius: 12px; background: var(--ink); border: 1px solid rgba(255,255,255,0.12); text-align: center; transition: transform 180ms cubic-bezier(.2,.9,.3,1.3), border-color 150ms, background 150ms; backdrop-filter: blur(6px); }
.hud .slot.on { border-color: var(--amber); background: rgba(52,34,14,0.8); transform: translateY(-6px); }
.hud .slot .k { position: absolute; left: 7px; top: 5px; font: 800 10px/1 Inter, sans-serif; opacity: 0.55; }
.hud .slot .c { position: absolute; right: 7px; top: 5px; font: 800 11px/1 Inter, sans-serif; color: var(--amber); }
.hud .slot svg { width: 30px; height: 30px; fill: none; stroke: var(--cream); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.hud .slot.on svg { stroke: var(--amber); }
.hud .slot .n { font: 700 11px/1 Inter, sans-serif; margin-top: 4px; letter-spacing: 0.03em; }
.hud .slot .cool { position: absolute; left: 8px; right: 8px; bottom: 3px; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.12); overflow: hidden; }
.hud .slot .cool i { display: block; height: 100%; background: var(--amber); }
.hud .hint { position: absolute; left: 50%; bottom: 128px; transform: translateX(-50%); font: 600 13px/1.4 Inter, sans-serif; text-shadow: 0 1px 4px #000; opacity: 0.85; white-space: nowrap; transition: opacity 300ms; }
.hud .hint b { display: inline-block; padding: 1px 6px; margin: 0 2px; border-radius: 4px; background: rgba(255,255,255,0.18); font-weight: 800; }
.hud .pops { position: absolute; inset: 0; overflow: hidden; }
.hud .pop { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; text-shadow: 0 2px 6px rgba(0,0,0,0.75); animation: rise 1.1s ease-out forwards; font-size: 22px; }
.hud .pop.big { font-size: 34px; color: var(--amber); }
.hud .pop.huge { font-size: 52px; color: #ffd27a; }
.hud .pop.bad { color: #ff7a5c; }
@keyframes rise { 0% { opacity: 0; transform: translate(-50%, -30%) scale(0.6); } 12% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); } 25% { transform: translate(-50%, -50%) scale(1); } 100% { opacity: 0; transform: translate(-50%, -150%) scale(0.95); } }
.replayview { position: fixed; inset: 0; z-index: 20; background: rgba(6,6,8,0.92); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; cursor: pointer; color: var(--cream); }
.replayview video { width: min(90vw, 1280px); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
.replayview .cap { font-size: 34px; letter-spacing: 0.04em; }
.replayview .close { font: 700 12px/1 Inter, sans-serif; letter-spacing: 0.2em; opacity: 0.6; }
.btn.watch { display: block; width: 100%; margin: 6px 0 10px; }
.hud .clock.alarm .t { color: #ff4a3a; font-size: 1.25em; animation: alarmpulse 1s infinite; }
@keyframes alarmpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }
.hud .prompt { position: absolute; left: 50%; top: calc(50% + 44px); transform: translateX(-50%); padding: 8px 14px; border-radius: 10px; background: rgba(16,17,22,0.72); font: 700 14px/1 Inter, sans-serif; letter-spacing: 0.02em; pointer-events: none; }
.hud .prompt[hidden] { display: none; }
.hud .prompt b { color: #1b1006; background: var(--amber); padding: 3px 7px; border-radius: 5px; margin-right: 6px; }
.hud .machinebar { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); padding: 11px 16px; border-radius: 12px; background: rgba(16,17,22,0.78); font: 600 13px/1.4 Inter, sans-serif; white-space: nowrap; pointer-events: none; }
.hud .machinebar[hidden] { display: none; }
.hud .machinebar b { color: var(--amber); }
.hud.riding .tools, .hud.riding .hint { display: none; }
.hud .spawnbar { position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-radius: 12px; background: var(--ink); border: 1px solid var(--amber); font: 700 12px/1 Inter, sans-serif; pointer-events: none; }
.hud .spawnbar[hidden] { display: none; }
.hud .spawnbar b { color: var(--amber); letter-spacing: 0.16em; margin-right: 6px; }
.hud .spawnbar span { padding: 6px 8px; border-radius: 8px; background: rgba(255,255,255,0.08); }
.hud .spawnbar i { font-style: normal; color: var(--amber); margin-right: 6px; }
.hud .spawnbar em { font-style: normal; opacity: 0.6; margin-left: 6px; }
.hud .smokeveil { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at 50% 55%, rgba(38,34,30,0.55) 0%, rgba(22,20,18,0.92) 70%, rgba(12,11,10,0.98) 100%); transition: opacity 120ms linear; }
.hud .banner { position: absolute; left: 50%; top: 26%; transform: translate(-50%, -50%); text-align: center; opacity: 0; pointer-events: none; text-shadow: 0 4px 18px rgba(0,0,0,0.6); }
.hud .banner .t { font-size: 76px; line-height: 0.95; color: #fff4dc; }
.hud .banner .s { font: 800 15px/1 Inter, sans-serif; letter-spacing: 0.3em; margin-top: 10px; color: var(--amber); }
.hud .banner.show { animation: banner 1.8s cubic-bezier(.2,.9,.3,1) forwards; }
.hud .banner.quick { top: 22%; }
.hud .banner.quick .t { font-size: 58px; }
.hud .banner.quick.show { animation-duration: 0.9s; }
@keyframes banner { 0% { opacity: 0; transform: translate(-50%, -50%) scale(1.6); } 10% { opacity: 1; transform: translate(-50%, -50%) scale(0.96); } 16% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -56%) scale(1); } }
.hud .flash { position: absolute; inset: 0; background: radial-gradient(circle, rgba(255,226,170,0.55), rgba(255,140,60,0.05) 75%); opacity: 0; }
.hud .lb { position: absolute; left: 0; right: 0; height: 0; background: #07080a; transition: height 260ms cubic-bezier(.2,.9,.3,1); }
.hud .lb.top { top: 0; } .hud .lb.bottom { bottom: 0; }
.hud.cine .lb { height: 9vh; }
.hud.cine .tools, .hud.cine .cross, .hud.cine .hint, .hud.cine .job { opacity: 0; }
.hud .cinecap { position: absolute; left: 50%; bottom: calc(9vh + 18px); transform: translateX(-50%); font: 800 12px/1 Inter, sans-serif; letter-spacing: 0.4em; opacity: 0; transition: opacity 200ms; color: var(--amber); text-shadow: 0 1px 6px #000; }
.hud.cine .cinecap { opacity: 0.9; }
.hud .toast { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); padding: 7px 16px; border-radius: 8px; background: var(--ink); font: 700 13px/1.3 Inter, sans-serif; opacity: 0; transition: opacity 300ms; }
.hud .stats { position: absolute; right: 22px; bottom: 16px; font: 600 11px/1.5 ui-monospace, monospace; text-align: right; opacity: 0.6; white-space: pre; text-shadow: 0 1px 3px #000; }
.hud .vignette { position: absolute; inset: 0; box-shadow: inset 0 0 140px rgba(200,40,20,0); transition: box-shadow 200ms; }
.hud .vignette.warn { box-shadow: inset 0 0 160px rgba(200,40,20,0.35); }

.screen { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; color: var(--cream); overflow-y: auto; }
.screen[hidden] { display: none; }
.title { background: linear-gradient(180deg, rgba(8,9,12,0.25) 0%, rgba(8,9,12,0.05) 35%, rgba(8,9,12,0.75) 100%); align-items: flex-end; padding: 0 0 6vh; }
.title .wrap { width: min(1180px, 94vw); }
.title .logo { font-size: clamp(64px, 11vw, 150px); line-height: 0.86; color: #fff6e4; text-shadow: 0 6px 30px rgba(0,0,0,0.45), 0 2px 0 #8a2a1c; letter-spacing: 0.01em; }
.title .logo span { color: var(--amber); }
.title .tag { font: 700 clamp(14px, 1.6vw, 19px)/1.4 Inter, sans-serif; margin: 10px 0 26px; opacity: 0.92; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
.title .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
@media (max-width: 1100px) { .title .cards { grid-template-columns: repeat(3, 1fr); } }
@media (max-height: 820px) { .title .logo { font-size: clamp(56px, 13vh, 150px); } .title .tag { margin: 6px 0 20px; } .title .card { padding: 11px 14px 10px; } .title .card .br { min-height: 0; } .title .card .ft { margin-top: 6px; } }
@media (max-width: 760px) { .title .cards { grid-template-columns: 1fr; } }
.title .modes { display: flex; gap: 8px; margin: -10px 0 14px; }
.title .modes button { padding: 9px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.16); background: rgba(16,17,22,0.7); color: var(--cream); font: 800 12px/1 Inter, sans-serif; letter-spacing: 0.14em; cursor: pointer; }
.title .modes button.on { background: var(--amber); color: #1b1006; border-color: var(--amber); }
.title .modes .what { align-self: center; margin-left: 8px; font: 600 13px/1.3 Inter, sans-serif; opacity: 0.85; text-shadow: 0 1px 4px #000; }
.card { position: relative; padding: 16px 18px 14px; border-radius: 14px; background: rgba(16,17,22,0.78); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(10px); cursor: pointer; transition: transform 160ms, border-color 160ms, background 160ms; text-align: left; color: inherit; font: inherit; }
.card.locked { opacity: 0.55; filter: grayscale(0.7); cursor: not-allowed; }
.card.locked:hover { transform: none; border-color: rgba(255,255,255,0.12); background: rgba(16,17,22,0.78); }
.card .lk { font: 800 11px/1 Inter, sans-serif; letter-spacing: 0.1em; color: var(--cream); opacity: 0.85; }
.card.shake { animation: shake 0.35s; }
@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
.title .tag .total { margin-left: 10px; color: var(--amber); white-space: nowrap; }
.hud .slot.locked { opacity: 0.35; }
.hud .slot.locked::after { content: attr(data-need); position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); font: 800 12px/1 Inter, sans-serif; color: var(--amber); }
.card:hover, .card.sel { transform: translateY(-4px); border-color: var(--amber); background: rgba(40,28,14,0.85); }
.card .no { font: 800 11px/1 Inter, sans-serif; letter-spacing: 0.2em; opacity: 0.6; }
.card .nm { font-size: 23px; line-height: 1.05; margin: 6px 0 6px; }
.card .br { font: 500 13px/1.4 Inter, sans-serif; opacity: 0.78; min-height: 36px; }
.card .ft { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font: 700 12px/1 Inter, sans-serif; }
.card .st { font-size: 17px; letter-spacing: 2px; color: rgba(255,255,255,0.25); }
.card .st b { color: var(--amber); font-weight: 400; }
.card .go { display: inline-block; padding: 7px 14px; border-radius: 8px; background: var(--amber); color: #1b1006; font: 800 12px/1 Inter, sans-serif; letter-spacing: 0.08em; }
.title .row2 { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 16px; font: 600 12px/1.5 Inter, sans-serif; opacity: 0.85; text-shadow: 0 1px 4px #000; }
.title .keys b { display: inline-block; padding: 1px 6px; margin: 0 2px 0 8px; border-radius: 4px; background: rgba(255,255,255,0.16); font-weight: 800; }
.btn { padding: 11px 18px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: var(--cream); font: 800 13px/1 Inter, sans-serif; letter-spacing: 0.06em; cursor: pointer; transition: background 140ms, border-color 140ms; }
.btn:hover { border-color: var(--amber); background: rgba(255,179,71,0.15); }
.btn.primary { background: var(--amber); border-color: var(--amber); color: #1b1006; }
.btn.primary:hover { background: #ffc36c; }
.btn:disabled { opacity: 0.5; cursor: default; }
.title .loading { font: 700 13px/1 Inter, sans-serif; color: var(--amber); }
.panel { width: min(460px, 92vw); padding: 26px 28px; border-radius: 16px; background: rgba(18,19,24,0.92); border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.pause { background: rgba(6,7,10,0.55); backdrop-filter: blur(5px); }
.pause h2 { margin: 0 0 14px; font-size: 40px; line-height: 1; }
.pause .row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin: 11px 0; font: 600 13px/1 Inter, sans-serif; }
.pause .row input[type=range] { width: 190px; accent-color: var(--amber); }
.pause .row select { background: #2a2d35; color: inherit; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 4px 8px; font: inherit; }
.pause .btns { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.pause .btns .btn { flex: 1; }
.pause .help { font: 500 12px/1.7 Inter, sans-serif; opacity: 0.75; margin: 0 0 12px; }
.pause .help b { display: inline-block; min-width: 14px; padding: 0 5px; border-radius: 4px; background: rgba(255,255,255,0.14); text-align: center; font-weight: 800; }
.end { background: radial-gradient(ellipse at 50% 60%, rgba(6,7,10,0.2), rgba(6,7,10,0.7)); }
.end .panel { text-align: center; width: min(520px, 92vw); animation: up 400ms cubic-bezier(.2,.9,.3,1.2); }
@keyframes up { from { opacity: 0; transform: translateY(30px) scale(0.96); } }
.end h2 { margin: 0; font-size: 58px; line-height: 1; color: #fff4dc; }
.end .sub { font: 700 13px/1.4 Inter, sans-serif; opacity: 0.75; margin: 6px 0 14px; letter-spacing: 0.06em; }
.end .stars { font-size: 54px; letter-spacing: 8px; color: rgba(255,255,255,0.16); margin: 4px 0 8px; }
.end .stars i { font-style: normal; display: inline-block; }
.end .stars i.got { color: var(--amber); animation: star 500ms cubic-bezier(.2,.9,.3,1.5) both; text-shadow: 0 0 22px rgba(255,170,60,0.6); }
@keyframes star { from { transform: scale(2.4) rotate(-30deg); opacity: 0; } }
.end table { width: 100%; border-collapse: collapse; font: 600 14px/1 Inter, sans-serif; margin: 6px 0 10px; }
.end td { padding: 7px 4px; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: left; }
.end td + td { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
.end .total { font-size: 46px; line-height: 1; margin: 12px 0 2px; }
.end .best { font: 800 12px/1 Inter, sans-serif; letter-spacing: 0.25em; color: var(--amber); min-height: 14px; }
.end .btns { display: flex; gap: 8px; margin-top: 18px; }
.end .btns .btn { flex: 1; }
`;

/** The controls, for the title and the pause card (the number keys run to however many tools there are). */
const HELP = (tools: number) => `<b>WASD</b> move · <b>Mouse</b> look · <b>Click</b> use tool · <b>1</b>–<b>${tools}</b> / wheel switch · <b>Space</b> jump · <b>Shift</b> sprint · <b>Right click</b> / <b>Q</b> detonate · <b>R</b> charge delay · <b>F</b> take loot (Salvage) · <b>L</b> load view · <b>Esc</b> pause`;

/** The game's modes: today's ninety-second contracts, or a blowdown planned with no clock and blown once. */
export type Mode = 'rush' | 'blowdown' | 'sandbox' | 'heist';
const MODES: Record<Mode, { name: string; what: string; tag: string }> = {
  rush: { name: 'RUSH', what: 'Ninety seconds, every tool. Score the chaos.', tag: 'Every brick is a body. Every storey can fall. You have ninety seconds.' },
  blowdown: { name: 'BLOWDOWN', what: 'No clock. Plan your charges and their delays, blow it once. Scored on a clean drop.', tag: 'Plan it. Wire it. One button. Drop it where it should fall.' },
  sandbox: { name: 'SANDBOX', what: 'Every tool, no limits, no clock. B spawns tanks, cars and bottles; T sets the time of day.', tag: 'Your lot. Your rules. Bring it all down, then do it again.' },
  heist: { name: 'SALVAGE', what: 'Plan with no clock. The first piece you take starts a 60 s alarm: grab the rest and reach the truck.', tag: 'Cut your way in. Take what they kept. Be gone before the chopper.' },
};

export class Hud {
  readonly root = document.createElement('div');
  private readonly el: Record<string, HTMLElement> = {};
  private readonly slots: HTMLElement[] = [];
  readonly title = document.createElement('div');
  readonly pause = document.createElement('div');
  readonly endScreen = document.createElement('div');
  private toastTimer = 0;
  private scoreShown = 0;
  private scoreTarget = 0;
  selected = 0;
  onStart: (id: number) => void = () => {};
  /** The title's mode tabs: the mode picked (the cards are drawn again for it). */
  onMode: (mode: Mode) => void = () => {};
  mode: Mode = 'rush';
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onQuit: () => void = () => {};
  onNext: () => void = () => {};
  onKeep: () => void = () => {};
  onSettings: () => void = () => {};
  onPick: (i: number) => void = () => {};

  readonly tools: Tool[];
  readonly settings: Settings;
  constructor(tools: Tool[], settings: Settings) {
    this.tools = tools;
    this.settings = settings;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const r = this.root;
    r.className = 'hud off';
    r.innerHTML = `
      <div class="vignette"></div>
      <div class="flash"></div>
      <div class="pops"></div>
      <div class="cross"><i></i><i></i><i></i><i></i></div>
      <svg class="ring" viewBox="0 0 46 46"><circle cx="23" cy="23" r="19" stroke-dasharray="119.4" stroke-dashoffset="119.4"/></svg>
      <div class="job"><div class="n d"></div><div class="b"></div><div class="meter"><i></i></div><div class="pct"></div><div class="keep"></div><div class="load"><span></span><i><b></b></i></div></div>
      <div class="clock"><div class="t d">1:30</div><div class="l">TIME</div></div>
      <div class="scorebox"><div class="score d">0</div><div class="combo"><div class="bar"><i></i></div><div class="x d">x1</div></div></div>
      <div class="hint"></div>
      <div class="tools"></div>
      <div class="banner"><div class="t d"></div><div class="s"></div></div>
      <div class="lb top"></div><div class="lb bottom"></div>
      <div class="cinecap">REPLAY · SLOW MOTION</div>
      <div class="toast"></div>
      <div class="stats"></div>`;
    r.prepend(this.smokeEl);
    r.append(this.spawnEl);
    r.append(this.promptEl);
    r.append(this.machineEl);
    for (const k of ['vignette', 'flash', 'pops', 'cross', 'ring', 'job', 'clock', 'score', 'combo', 'hint', 'tools', 'banner', 'toast', 'stats', 'cinecap'])
      this.el[k] = r.querySelector(`.${k}`) as HTMLElement;
    for (const t of tools) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = `<span class="k">${t.key}</span><span class="c"></span>${t.icon}<div class="n">${t.name}</div><div class="cool"><i style="width:100%"></i></div>`;
      this.el.tools.append(s);
      this.slots.push(s);
    }
    document.body.append(r);

    this.title.className = 'screen title';
    document.body.append(this.title);
    this.pause.className = 'screen pause';
    this.pause.hidden = true;
    document.body.append(this.pause);
    this.endScreen.className = 'screen end';
    this.endScreen.hidden = true;
    document.body.append(this.endScreen);
    this.buildPause();
    if (!new URLSearchParams(location.search).has('debug')) this.el.stats.style.display = 'none';
  }

  // ---------- title ----------
  showTitle(cards: ContractCard[], selected: number, loading: string | null): void {
    this.selected = selected;
    this.title.hidden = false;
    this.root.classList.add('off');
    const stars = (n: number) => [0, 1, 2].map((k) => (k < n ? '<b>★</b>' : '★')).join('');
    const m = MODES[this.mode];
    this.title.innerHTML = `<div class="wrap">
      <div class="logo d">Brick<span>fall</span></div>
      <div class="tag">${m.tag}${this.starTotal !== null ? ` <span class="total">★ ${this.starTotal}</span>` : ''}</div>
      <div class="modes">${(Object.keys(MODES) as Mode[]).map((k) => `<button data-mode="${k}" class="${k === this.mode ? 'on' : ''}">${MODES[k].name}</button>`).join('')}<span class="what">${m.what}</span></div>
      <div class="cards">${cards
        .map(
          (c, k) => `<button class="card${c.id === selected ? ' sel' : ''}${c.locked ? ' locked' : ''}" data-id="${c.id}"${c.locked ? ` data-locked="${c.locked}"` : ''}>
          <div class="no">${this.mode === 'blowdown' ? 'BLOWDOWN' : this.mode === 'sandbox' ? 'LOT' : this.mode === 'heist' ? 'HEIST' : 'CONTRACT'} ${k + 1}</div><div class="nm d">${c.name}</div><div class="br">${c.brief}</div>
          <div class="ft"><span class="st">${stars(c.stars)}</span><span>${c.locked ? `<span class="lk">LOCKED · ${c.locked} ★</span>` : c.best ? `BEST ${c.best.toLocaleString()}` : '<span class="go">START</span>'}</span></div></button>`,
        )
        .join('')}</div>
      <div class="row2"><span class="keys">${HELP(this.tools.length)}</span><span class="loading">${loading ?? ''}</span></div>
    </div>`;
    this.title.querySelectorAll<HTMLButtonElement>('.card').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.loadingText) return;
        if (b.dataset.locked) {
          b.classList.remove('shake');
          void b.offsetWidth;
          b.classList.add('shake');
          return;
        }
        this.onStart(Number(b.dataset.id));
      }),
    );
    this.title.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.mode = b.dataset.mode as Mode;
        this.onMode(this.mode);
      }),
    );
    this.loadingText = loading;
  }
  private loadingText: string | null = null;
  setLoading(text: string | null): void {
    this.loadingText = text;
    const l = this.title.querySelector('.loading');
    if (l) l.textContent = text ?? 'Click a contract to start';
  }
  hideTitle(): void {
    this.title.hidden = true;
  }
  get titleOpen(): boolean {
    return !this.title.hidden;
  }

  // ---------- pause ----------
  private buildPause(): void {
    const s = this.settings;
    this.pause.innerHTML = `<div class="panel">
      <h2 class="d">Paused</h2>
      <p class="help">${HELP(this.tools.length)}</p>
      <div class="row"><span>Look sensitivity</span><input type="range" name="sensitivity" min="0.2" max="3" step="0.05"></div>
      <div class="row"><span>Field of view</span><input type="range" name="fov" min="60" max="110" step="1"></div>
      <div class="row"><span>Sound</span><input type="range" name="volume" min="0" max="1" step="0.05"></div>
      <div class="row"><span>Music</span><input type="range" name="music" min="0" max="1" step="0.05"></div>
      <div class="row"><span>Screen shake</span><input type="checkbox" name="shake"></div>
      <div class="row"><span>Invert look</span><input type="checkbox" name="invertY"></div>
      <div class="row"><span>Graphics</span><select name="graphics"><option value="auto">Auto (tuned)</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <div class="btns"><button class="btn primary resume">RESUME</button><button class="btn restart">RESTART</button><button class="btn quit">CONTRACTS</button></div>
    </div>`;
    const input = (name: string) => this.pause.querySelector(`[name=${name}]`) as HTMLInputElement;
    for (const name of ['sensitivity', 'fov', 'volume', 'music'] as const) {
      input(name).value = String(s[name]);
      input(name).addEventListener('input', () => {
        s[name] = Number(input(name).value);
        this.onSettings();
      });
    }
    for (const name of ['shake', 'invertY'] as const) {
      input(name).checked = s[name];
      input(name).addEventListener('change', () => {
        s[name] = input(name).checked;
        this.onSettings();
      });
    }
    const g = this.pause.querySelector('select') as HTMLSelectElement;
    g.value = s.graphics;
    g.addEventListener('change', () => {
      s.graphics = g.value as Settings['graphics'];
      this.onSettings();
    });
    (this.pause.querySelector('.resume') as HTMLElement).addEventListener('click', () => this.onResume());
    (this.pause.querySelector('.restart') as HTMLElement).addEventListener('click', () => this.onRestart());
    (this.pause.querySelector('.quit') as HTMLElement).addEventListener('click', () => this.onQuit());
  }
  showPause(on: boolean): void {
    this.pause.hidden = !on;
  }

  // ---------- end ----------
  showEnd(r: EndResult | null): void {
    if (!r) {
      this.endScreen.hidden = true;
      return;
    }
    this.endScreen.hidden = false;
    const stars = [0, 1, 2].map((k) => `<i class="${k < r.stars ? 'got' : ''}" style="animation-delay:${300 + k * 280}ms">★</i>`).join('');
    this.endScreen.innerHTML = `<div class="panel">
      <h2 class="d">${r.title}</h2><div class="sub">${r.sub}</div>
      <div class="stars">${stars}</div>
      <table>${r.rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
      <div class="total d">${r.score.toLocaleString()}</div>
      <div class="best">${r.best ? 'NEW BEST' : ''}</div>
      ${r.replay ? `<button class="btn watch">▶ WATCH THE BEST MOMENT · ${r.replay.label}</button>` : ''}
      <div class="btns"><button class="btn keep">KEEP WRECKING</button><button class="btn retry">RETRY</button>${r.hasNext ? '<button class="btn primary next">NEXT</button>' : ''}<button class="btn quit">CONTRACTS</button></div>
    </div>`;
    const replay = r.replay;
    if (replay)
      this.endScreen.querySelector('.watch')?.addEventListener('click', () => {
        const v = document.createElement('div');
        v.className = 'replayview';
        v.innerHTML = `<video src="${replay.url}" autoplay loop muted playsinline></video><div class="cap d">${replay.label}</div><div class="close">CLICK TO CLOSE</div>`;
        v.addEventListener('click', () => v.remove());
        document.body.append(v);
      });
    (this.endScreen.querySelector('.retry') as HTMLElement).addEventListener('click', () => this.onRestart());
    (this.endScreen.querySelector('.keep') as HTMLElement).addEventListener('click', () => this.onKeep());
    this.endScreen.querySelector('.next')?.addEventListener('click', () => this.onNext());
    (this.endScreen.querySelector('.quit') as HTMLElement).addEventListener('click', () => this.onQuit());
  }

  // ---------- in game ----------
  show(on: boolean): void {
    this.root.classList.toggle('off', !on);
  }
  setJob(name: string, brief: string, stars: number[]): void {
    const j = this.el.job;
    (j.querySelector('.n') as HTMLElement).textContent = name;
    (j.querySelector('.b') as HTMLElement).textContent = brief;
    const meter = j.querySelector('.meter') as HTMLElement;
    meter.querySelectorAll('.tick, .star').forEach((e) => e.remove());
    for (const s of stars) {
      meter.insertAdjacentHTML('beforeend', `<span class="tick" style="left:${s * 100}%"></span><span class="star" style="left:${s * 100}%">★</span>`);
    }
  }
  /** The heist's tally in the job panel: the bar is the required loot taken, the line says what's left. */
  loot(share: number, text: string): void {
    const j = this.el.job;
    (j.querySelector('.meter > i') as HTMLElement).style.width = `${Math.min(100, share * 100).toFixed(1)}%`;
    j.querySelectorAll('.star').forEach((e) => e.classList.remove('got'));
    (j.querySelector('.pct') as HTMLElement).textContent = text;
  }
  job(share: number, stars: number[], label: string): void {
    const j = this.el.job;
    (j.querySelector('.meter > i') as HTMLElement).style.width = `${Math.min(100, share * 100).toFixed(1)}%`;
    j.querySelectorAll('.star').forEach((e, k) => e.classList.toggle('got', share >= stars[k]));
    (j.querySelector('.pct') as HTMLElement).textContent = `${label} ${Math.floor(share * 100)}% DOWN`;
  }
  /** The job's most loaded storey ("STOREY 1 · 86% LOAD"), its load 0..1 as a bar, red near giving way; null hides it. */
  load(text: string | null, share = 0, red = false): void {
    const l = this.el.job.querySelector('.load') as HTMLElement;
    l.classList.toggle('on', text !== null);
    l.classList.toggle('red', red);
    if (text === null) return;
    (l.querySelector('span') as HTMLElement).textContent = text;
    (l.querySelector('b') as HTMLElement).style.width = `${Math.round(Math.min(1, share) * 100)}%`;
  }
  /** A prompt under the crosshair (what F does here), or null. */
  prompt(html: string | null): void {
    if (html === this.promptHtml) return;
    this.promptHtml = html;
    this.promptEl.hidden = !html;
    if (html) this.promptEl.innerHTML = html;
  }
  private promptHtml: string | null = null;
  private readonly promptEl = (() => {
    const d = document.createElement('div');
    d.className = 'prompt';
    d.hidden = true;
    return d;
  })();
  /** In a machine: its controls along the bottom in place of the tools (null: on foot). */
  machine(html: string | null): void {
    this.machineEl.hidden = !html;
    if (html) this.machineEl.innerHTML = html;
    this.root.classList.toggle('riding', !!html);
  }
  private readonly machineEl = (() => {
    const d = document.createElement('div');
    d.className = 'machinebar';
    d.hidden = true;
    return d;
  })();
  /** The sandbox's spawn bar: the props by number, or null to hide it. */
  spawnBar(items: string[] | null): void {
    this.spawnEl.hidden = !items;
    if (items) this.spawnEl.innerHTML = `<b>SPAWN</b>${items.map((n, k) => `<span><i>${k + 1}</i>${n}</span>`).join('')}<em>B to close</em>`;
  }
  private readonly spawnEl = (() => {
    const d = document.createElement('div');
    d.className = 'spawnbar';
    d.hidden = true;
    return d;
  })();
  /** Smoke in the eyes (0..1): the view browns and closes in. */
  smoke(amount: number): void {
    this.smokeEl.style.opacity = amount < 0.02 ? '0' : String(Math.min(0.85, amount * 0.9));
  }
  private readonly smokeEl = (() => {
    const d = document.createElement('div');
    d.className = 'smokeveil';
    return d;
  })();
  keep(text: string, lost: boolean): void {
    const k = this.el.job.querySelector('.keep') as HTMLElement;
    k.textContent = text;
    k.classList.toggle('lost', lost);
  }
  clock(seconds: number, label = 'TIME', tenths = false): void {
    const s = Math.max(0, Math.ceil(seconds));
    (this.el.clock.querySelector('.t') as HTMLElement).textContent = tenths ? Math.max(0, seconds).toFixed(1) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.clock.classList.toggle('alarm', tenths);
    (this.el.clock.querySelector('.l') as HTMLElement).textContent = label;
    this.el.clock.classList.toggle('low', seconds <= 10 && seconds > 0);
    this.el.vignette.classList.toggle('warn', seconds <= 5 && seconds > 0);
  }
  /** The score counts up toward `n`; `combo` the multiplier, `fill` its window left (0..1). */
  score(n: number, combo: number, fill: number): void {
    if (n > this.scoreTarget) {
      this.el.score.classList.remove('bump');
      void this.el.score.offsetWidth;
      this.el.score.classList.add('bump');
    }
    this.scoreTarget = n;
    const c = this.el.combo;
    c.classList.toggle('on', combo > 1.001);
    c.classList.toggle('hot', combo >= 3);
    (c.querySelector('.x') as HTMLElement).textContent = `x${combo.toFixed(combo % 1 ? 2 : 0)}`;
    (c.querySelector('.bar i') as HTMLElement).style.width = `${Math.round(fill * 100)}%`;
  }
  resetScore(): void {
    this.scoreShown = this.scoreTarget = 0;
    this.el.score.textContent = '0';
  }
  /** Each frame: the shown score rolls toward the real one. */
  tick(dt: number): void {
    if (this.scoreShown !== this.scoreTarget) {
      const d = this.scoreTarget - this.scoreShown;
      this.scoreShown += Math.sign(d) * Math.max(1, Math.abs(d) * Math.min(1, dt * 9));
      if (Math.abs(this.scoreTarget - this.scoreShown) < 1) this.scoreShown = this.scoreTarget;
      this.el.score.textContent = Math.round(this.scoreShown).toLocaleString();
    } else this.el.score.classList.remove('bump');
  }
  select(i: number): void {
    this.slots.forEach((s, k) => s.classList.toggle('on', k === i));
    this.hint(this.tools[i].hint);
  }
  /** Tool `i`'s count badge and cooldown (0..1 ready). */
  /** Stars earned in all (shown on the title), or null to hide. */
  starTotal: number | null = null;
  /** A tool still locked: its slot dimmed with the stars it needs (null: open). */
  lockSlot(i: number, stars: number | null): void {
    const s = this.slots[i];
    s.classList.toggle('locked', stars !== null);
    s.dataset.need = stars === null ? '' : `${stars} ★`;
  }
  slot(i: number, count: string, ready: number): void {
    const s = this.slots[i];
    (s.querySelector('.c') as HTMLElement).textContent = count;
    (s.querySelector('.cool i') as HTMLElement).style.width = `${Math.round(Math.min(1, ready) * 100)}%`;
  }
  hint(html: string): void {
    this.el.hint.innerHTML = html;
  }
  aim(on: boolean): void {
    this.el.cross.classList.toggle('hit', on);
  }
  kick(): void {
    const c = this.el.cross;
    c.classList.remove('kick');
    void c.offsetWidth;
    c.classList.add('kick');
  }
  /** The sledge's charge ring round the crosshair (0: hidden). */
  chargeRing(f: number): void {
    this.el.ring.classList.toggle('on', f > 0.02);
    (this.el.ring.querySelector('circle') as SVGCircleElement).style.strokeDashoffset = String(119.4 * (1 - Math.min(1, f)));
  }
  /** Floating text at screen position (px). */
  popup(x: number, y: number, text: string, size: 'small' | 'big' | 'huge' | 'bad' = 'small'): void {
    const p = document.createElement('div');
    p.className = `pop d ${size === 'small' ? '' : size}`;
    p.textContent = text;
    p.style.left = `${Math.max(60, Math.min(innerWidth - 60, x))}px`;
    p.style.top = `${Math.max(90, Math.min(innerHeight - 160, y))}px`;
    this.el.pops.append(p);
    setTimeout(() => p.remove(), 1150);
    while (this.el.pops.childElementCount > 14) this.el.pops.firstElementChild?.remove();
  }
  /** A banner: a contract's name, the end of the clock; `quick` for a call-out in play (smaller, higher, 0.9 s). */
  banner(text: string, sub = '', quick = false): void {
    const b = this.el.banner;
    (b.querySelector('.t') as HTMLElement).textContent = text;
    (b.querySelector('.s') as HTMLElement).textContent = sub;
    b.classList.toggle('quick', quick);
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }
  flash(strength: number): void {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = String(Math.min(1, strength));
    void f.offsetWidth;
    f.style.transition = 'opacity 450ms ease-out';
    f.style.opacity = '0';
  }
  cine(on: boolean, caption = 'REPLAY · SLOW MOTION'): void {
    this.root.classList.toggle('cine', on);
    this.el.cinecap.textContent = caption;
  }
  toast(text: string): void {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.el.toast.style.opacity = '0'), 1600);
  }
  stats(text: string): void {
    this.el.stats.textContent = text;
  }
}
