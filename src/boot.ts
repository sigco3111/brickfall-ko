// The page's entry: check for WebGPU before loading anything heavy. Brickfall's physics runs on
// the GPU through WebGPU compute (three-avbd), so without it there is no game: say so plainly,
// over a picture of what it looks like, and load nothing else.

import '@fontsource/anton/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/black-han-sans/korean-400.css';
import '@fontsource/noto-sans-kr/korean-400.css';
import '@fontsource/noto-sans-kr/korean-500.css';
import '@fontsource/noto-sans-kr/korean-700.css';
import '@fontsource/noto-sans-kr/korean-800.css';

async function webgpu(): Promise<string | null> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return '이 브라우저는 WebGPU를 제공하지 않습니다.';
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return '이 브라우저는 WebGPU를 지원하지만, 사용할 수 있는 그래픽 카드를 찾지 못했습니다.';
  } catch {
    return '이 브라우저는 WebGPU를 지원하지만, 시작하지 못했습니다.';
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
  if (params.has('nogpu')) reason = 'WebGPU가 없을 때 표시되는 화면의 미리보기입니다.';
  if (reason) {
    needsWebGPU(reason);
    return;
  }
  void import('./main.ts');
});
