// Patch credits overlay: a small "i" button (bottom-left) that toggles a credits panel.
(() => {
  const C = {
    title: "Brickfall",
    author: "Steven Bobyn의 three-voxel-destruction 기반, Patch 제작 · 한글화 미러",
    license: "코드 MIT. 텍스처·하늘 CC0 (Poly Haven). 효과음: CC0·CC-BY 오픈 녹음 + 생성음·합성음. 전체 목록은 CREDITS.md",
    source: "github.com/sbobyn/three-voxel-destruction (MIT) · three-avbd (MIT) · three.js (MIT)",
    note: "원작: Patch. 한글화 저장소는 별도 미러입니다.",
  };
  const d = document, root = d.createElement("div");
  root.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:2147483647;pointer-events:none;font:13px/1.45 system-ui,sans-serif;color:#eee";
  const btn = d.createElement("button");
  btn.type = "button";
  btn.textContent = "i";
  btn.setAttribute("aria-label", "크레딧");
  btn.setAttribute("aria-expanded", "false");
  btn.style.cssText = "pointer-events:auto;width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.35);color:rgba(255,255,255,.8);font:italic 600 13px Georgia,serif;cursor:pointer;opacity:.6;padding:0";
  const panel = d.createElement("div");
  panel.hidden = true;
  panel.style.cssText = "pointer-events:auto;position:absolute;left:0;bottom:32px;width:min(320px,80vw);padding:12px 14px;border-radius:8px;background:rgba(10,12,14,.9);border:1px solid rgba(255,255,255,.18);box-shadow:0 6px 24px rgba(0,0,0,.5)";
  const line = (t, s) => { const p = d.createElement("div"); p.textContent = t; if (s) p.style.cssText = s; panel.append(p); };
  line(C.title, "font-weight:600;font-size:15px;margin-bottom:4px");
  line(C.author);
  line("라이선스: " + C.license);
  line("소스: " + C.source, "word-break:break-all;user-select:text");
  line("효과음: Patch의 voxel-destruction 블록에서 가져온 Freesound·Kenney의 CC0/CC-BY 녹음(CC-BY: richardemoore, YleArkisto, juskiddink, DWOBoyle). 음악·혼은 Sonilo·ElevenLabs 생성. 폰트: Anton, Inter, Black Han Sans, Noto Sans KR (OFL).", "margin-top:6px;opacity:.8");
  line(C.note, "margin-top:6px;opacity:.7");
  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
    btn.style.opacity = panel.hidden ? ".6" : "1";
    btn.blur();
  });
  const stop = (e) => e.stopPropagation();
  for (const t of ["keydown", "keyup", "keypress", "pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "wheel", "touchstart", "touchend"])
    for (const el of [btn, panel]) el.addEventListener(t, stop);
  root.append(panel, btn);
  (d.body || d.documentElement).append(root);
})();
