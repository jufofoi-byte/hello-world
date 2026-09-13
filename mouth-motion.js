// 입 주변 움직임 감지기: 얼굴 랜드마크로 잡은 입 영역 안에서 프레임 간 밝기 변화를 재서
// 칫솔이 움직이고 있는지 판단한다. 샘플 위치를 입 중심·얼굴 크기 기준으로 잡기 때문에
// 머리가 조금 움직이거나 카메라와의 거리가 바뀌어도 그 자체는 움직임으로 치지 않는다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MouthMotion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    cols: 24, rows: 14,   // 샘플 격자
    spanX: 1.15,          // 입 영역 가로 폭 (얼굴 너비 배수)
    spanY: 0.5,           // 입 영역 세로 폭 (얼굴 높이 배수)
    threshold: 6,         // 평균 밝기 변화(0~255)가 이 이상이면 "움직임"
    lagMs: 250,           // 이만큼 이전 프레임과 비교한다 (천천히 움직여도 차이가 쌓이도록)
    smooth: 0.35,         // 변화량 EMA 계수
    holdMs: 400,          // 움직임이 잠깐 끊겨도 이 시간 동안은 "닦는 중" 유지
  };

  function createDetector(options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    let hist = [], ema = 0, lastMoveAt = -Infinity;   // hist: 최근 프레임 격자들 { t, g }
    const n = opts.cols * opts.rows;

    function reset() { hist = []; ema = 0; lastMoveAt = -Infinity; }

    // data: RGBA 픽셀, w/h: 프레임 크기, mouth: { center:{x,y}, faceW, faceH } (정규화 좌표), t: ms
    function update(data, w, h, mouth, t) {
      const cx = mouth.center.x * w, cy = mouth.center.y * h;
      const halfW = mouth.faceW * w * opts.spanX / 2, halfH = mouth.faceH * h * opts.spanY / 2;
      const cur = new Float32Array(n);
      let k = 0;
      for (let r = 0; r < opts.rows; r++) {
        const y = Math.min(h - 1, Math.max(0, Math.round(cy - halfH + (2 * halfH) * (r + 0.5) / opts.rows)));
        for (let c = 0; c < opts.cols; c++) {
          const x = Math.min(w - 1, Math.max(0, Math.round(cx - halfW + (2 * halfW) * (c + 0.5) / opts.cols)));
          const i = (y * w + x) * 4;
          cur[k++] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
      }
      // lagMs 이전(또는 가장 오래된) 격자와 비교
      let ref = null;
      for (let i = hist.length - 1; i >= 0; i--) { ref = hist[i]; if (t - hist[i].t >= opts.lagMs) break; }
      let diff = 0;
      if (ref) { for (let i = 0; i < n; i++) diff += Math.abs(cur[i] - ref.g[i]); diff /= n; }
      hist.push({ t, g: cur });
      while (hist.length > 1 && t - hist[0].t > opts.lagMs * 2) hist.shift();
      ema = ema + (diff - ema) * opts.smooth;
      if (ema >= opts.threshold) lastMoveAt = t;
      const moving = t - lastMoveAt <= opts.holdMs;
      return { diff, ema, moving, box: { x: cx - halfW, y: cy - halfH, w: 2 * halfW, h: 2 * halfH } };
    }
    return { update, reset, opts };
  }

  return { createDetector, DEFAULTS };
});
