// The page's entry: check for WebGPU before loading anything heavy. Brickfall's physics runs on
// the GPU through WebGPU compute (three-avbd), so without it there is no game: say so plainly,
// over a picture of what it looks like, and load nothing else.

import '@fontsource/anton/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';

async function webgpu(): Promise<string | null> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return 'This browser does not offer WebGPU.';
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return 'This browser has WebGPU, but could not find a graphics card it can use.';
  } catch {
    return 'This browser has WebGPU, but could not start it.';
  }
  return null;
}

function needsWebGPU(reason: string): void {
  document.getElementById('loader')?.remove();
  const el = document.getElementById('nogpu') as HTMLElement;
  (el.querySelector('.why') as HTMLElement).textContent = reason;
  el.hidden = false;
}

const params = new URLSearchParams(location.search);
void webgpu().then((reason) => {
  if (params.has('nogpu')) reason = 'Preview of the screen shown where WebGPU is missing.';
  if (reason) {
    needsWebGPU(reason);
    return;
  }
  void import('./main.ts');
});
