// 칫솔 머리 색 추적기: 저장해 둔 칫솔 색과 비슷한 픽셀 덩어리를 입 주변에서 찾는다.
// 작은 해상도(예: 160x120)의 ImageData 위에서 동작하도록 만들어져 프레임마다 돌려도 가볍다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrushTracker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    tolChroma: 16,   // Cb/Cr 거리 허용치
    tolLuma: 70,     // 밝기 차 허용치 (조명 변화에 관대하게)
    minCount: 5,     // 이 픽셀 수 이상 모여야 덩어리로 인정
    nearRadius: 0.3, // 직전 위치 반경(얼굴 너비 배수) 안을 먼저 찾는다
  };

  function ycc(r, g, b) {
    return {
      y: 0.299 * r + 0.587 * g + 0.114 * b,
      cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
      cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
    };
  }
  function chromaDist(a, b) { return Math.hypot(a.cb - b.cb, a.cr - b.cr); }
  function matches(px, color, opts) { return chromaDist(px, color) <= opts.tolChroma && Math.abs(px.y - color.y) <= opts.tolLuma; }

  // 원 안 픽셀들의 중앙값 색 (data: Uint8ClampedArray RGBA, w/h: 픽셀 크기, cx/cy/r: 픽셀 단위)
  function sampleColor(data, w, h, cx, cy, r) {
    const ys = [], cbs = [], crs = [];
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * w + x) * 4;
      const c = ycc(data[i], data[i + 1], data[i + 2]);
      ys.push(c.y); cbs.push(c.cb); crs.push(c.cr);
    }
    if (!ys.length) return null;
    const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    return { y: med(ys), cb: med(cbs), cr: med(crs), n: ys.length };
  }

  // 색과 맞는 픽셀의 무게중심을 찾는다. prev가 있으면 그 근처를 먼저 본다.
  // window: {x0,y0,x1,y1} 픽셀 좌표, prev: {x,y,r} 픽셀 좌표
  function findBlob(data, w, h, color, window, prev, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const x0 = Math.max(0, Math.floor(window.x0)), x1 = Math.min(w - 1, Math.ceil(window.x1));
    const y0 = Math.max(0, Math.floor(window.y0)), y1 = Math.min(h - 1, Math.ceil(window.y1));
    const pass = (limit) => {
      let sx = 0, sy = 0, n = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (limit && (x - limit.x) ** 2 + (y - limit.y) ** 2 > limit.r * limit.r) continue;
        const i = (y * w + x) * 4;
        if (matches(ycc(data[i], data[i + 1], data[i + 2]), color, opts)) { sx += x; sy += y; n++; }
      }
      return n >= opts.minCount ? { x: sx / n, y: sy / n, count: n } : null;
    };
    if (prev) { const r = pass(prev); if (r) return r; }
    return pass(null);
  }

  return { ycc, chromaDist, sampleColor, findBlob, DEFAULTS };
});
