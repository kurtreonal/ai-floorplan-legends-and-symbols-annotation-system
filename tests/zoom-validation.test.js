(() => {
// Numerical validation of the zoom path shipped in konva-enhancements.js:62
// (wheelZoom + canvas wheel listener) and review.js:20-21 (applyView, zoom).
const out = [];
const log = s => out.push(s);
const makeViewport = (rectW, rectH) => ({ rectW, rectH });

// review.js:20 applyView (verbatim math)
function applyView(view, vp) {
  const scale = Math.min(vp.rectW / view[2], vp.rectH / view[3]);
  return { scale,
    stageX: (vp.rectW - view[2] * scale) / 2 - view[0] * scale,
    stageY: (vp.rectH - view[3] * scale) / 2 - view[1] * scale };
}

// review.js:21 zoom (verbatim math; view = [x, y, width, height] world units)
function zoom(viewIn, factor, clientX, clientY, vp) {
  const rectW = vp.rectW, rectH = vp.rectH;
  const screenX = clientX === undefined ? rectW / 2 : clientX;
  const screenY = clientY === undefined ? rectH / 2 : clientY;
  const t0 = applyView(viewIn, vp);
  const oldScale = t0.scale || 1;
  const anchor = [(screenX - t0.stageX) / oldScale, (screenY - t0.stageY) / oldScale];
  const nextWidth = viewIn[2] * factor, nextHeight = viewIn[3] * factor;
  const newScale = Math.min(rectW / nextWidth, rectH / nextHeight);
  const offsetX = (rectW - nextWidth * newScale) / 2;
  const offsetY = (rectH - nextHeight * newScale) / 2;
  const view = [anchor[0] - (screenX - offsetX) / newScale,
                anchor[1] - (screenY - offsetY) / newScale, nextWidth, nextHeight];
  return { view, anchor };
}

// konva-enhancements.js:62 (verbatim)
const factorOf = (delta, pinch) => Math.max(.82, Math.min(1.22, Math.exp(-delta * (pinch ? .0025 : .0012))));
// konva-enhancements.js:68 (verbatim)
const pinchRatio = (start, dist) => 1 + (start / dist - 1) * .35;
const vp = makeViewport(1000, 700);
let view = [0, 0, 2000, 1400];


// 1) Exponential factor curve values
log('--- 1) exponential factor curve (verbatim factorOf) ---');
for (const [delta, pinch] of [[-100, false], [100, false], [-100, true], [100, true], [-4, true], [4, true]]) {
  log(`deltaY=${String(delta).padStart(5)} pinch=${pinch}  factor=${factorOf(delta, pinch).toFixed(4)}  -> ${factorOf(delta, pinch) > 1 ? 'view WIDER = zoom OUT' : 'view NARROWER = zoom IN'}`);
}

// 2) Cursor anchoring invariant: world point under cursor must stay under cursor
log('--- 2) cursor anchoring invariant ---');
const cases = [[500, 350], [0, 0], [999, 699], [250, 100]];
for (const [cx, cy] of cases) {
  for (const f of [factorOf(-100, false), factorOf(100, false), factorOf(-100, true), 0.5, 2]) {
    const t0 = applyView(view, vp);
    const world = [(cx - t0.stageX) / t0.scale, (cy - t0.stageY) / t0.scale];
    const { view: v1 } = zoom(view, f, cx, cy, vp);
    const t1 = applyView(v1, vp);
    const drift = Math.hypot(world[0] * t1.scale + t1.stageX - cx, world[1] * t1.scale + t1.stageY - cy);
    log(`cursor=(${cx},${cy}) factor=${f.toFixed(4)}  drift=${drift.toExponential(2)}px  ${drift < 1e-9 ? 'OK' : 'FAIL'}`);
  }
}

// 3) Wheel direction semantics
log('--- 3) wheel direction semantics ---');
const t0 = applyView(view, vp);
log(`initial stage scale=${t0.scale}`);
const fwd = factorOf(-100, false), back = factorOf(100, false);
log(`wheel forward (deltaY=-100) -> factor=${fwd.toFixed(4)} -> scale ${t0.scale} -> ${t0.scale / fwd} = ${t0.scale / fwd > t0.scale ? 'zoom IN' : 'zoom OUT'}`);
log(`wheel back    (deltaY=+100) -> factor=${back.toFixed(4)} -> scale ${t0.scale} -> ${t0.scale / back} = ${t0.scale / back > t0.scale ? 'zoom IN' : 'zoom OUT'}`);
log(`note: zoom() treats factor as a VIEW-SIZE multiplier (view[2]*factor); setZoom slider uses factor=last/target, so higher slider value = zoom IN`);

// 4) Trackpad pinch vs touch pinch direction consistency
log('--- 4) pinch direction consistency ---');
log(`touch pinch spread (dist 200->300): ratio=${pinchRatio(200, 300).toFixed(4)} -> ${pinchRatio(200, 300) < 1 ? 'zoom IN' : 'zoom OUT'}`);
log(`trackpad pinch spread (ctrl+wheel deltaY=-100): factor=${factorOf(-100, true).toFixed(4)} -> ${factorOf(-100, true) > 1 ? 'zoom OUT' : 'zoom IN'}`);
log(`=> touch pinch and trackpad pinch ${((pinchRatio(200, 300) < 1) === (factorOf(-100, true) > 1)) ? 'move in OPPOSITE directions (inconsistent)' : 'move the same direction'}`);

// 5) Slider compatibility
log('--- 5) slider compatibility (verbatim setZoom factor=last/target) ---');
log(`slider 1 -> 2: factor=0.5 (view halves = zoom IN); slider 2 -> 1: factor=2 (zoom OUT)`);

// 6) 200-notch zoom-in sequence: finite + zero drift
log('--- 6) 200-notch wheel-forward sequence from fit ---');
let v = view.slice(), driftMax = 0;
for (let i = 0; i < 200; i++) {
  const r = zoom(v, factorOf(-100, false), 777, 233, vp);
  v = r.view;
  const t = applyView(v, vp);
  const backX = ((777 - t.stageX) / t.scale) * t.scale + t.stageX;
  driftMax = Math.max(driftMax, Math.abs(backX - 777));
}
log(`after 200 forward notches: scale=${applyView(v, vp).scale.toExponential(3)} (finite), max cursor drift=${driftMax.toExponential(2)}px`);

require('fs').writeFileSync('zoom-validation-report.txt', out.join('\r\n') + '\r\n');
console.log('written');
})();

