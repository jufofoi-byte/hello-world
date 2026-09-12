// 얼굴·손 랜드마크로 "어느 구역을 닦고 있는지" 판정하는 순수 함수 모음.
// 좌표는 카메라 원본(거울 반전 전) 정규화 좌표(0~1)를 그대로 사용한다.
// 전면 카메라 원본에서는 사용자의 오른쪽이 화면 왼쪽(x가 작은 쪽)에 찍힌다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrushAnalyzer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // MediaPipe FaceLandmarker 인덱스
  const FACE = { lipTop: 13, lipBottom: 14, mouthL: 61, mouthR: 291, cheekL: 234, cheekR: 454, forehead: 10, chin: 152 };
  // MediaPipe HandLandmarker 인덱스
  const HAND = { wrist: 0, indexMcp: 5, middleMcp: 9, pinkyMcp: 17, thumbTip: 4 };

  const DEFAULTS = {
    handleLen: 0.42,      // 손아귀 중심에서 칫솔 머리까지 거리 (얼굴 너비 배수)
    nearDist: 0.6,        // 칫솔 머리가 입 중심에서 이 거리(얼굴 너비 배수) 안이면 "입 근처"
    window: 1.0,          // 움직임을 누적해 보는 시간 창(초)
    minMotion: 0.04,      // 시간 창 동안 손이 움직인 폭(얼굴 너비 배수, 약 0.6cm)이 이 이상이면 "닦는 중". 천천히 움직여도 통과
    gripSmooth: 0.5,      // 손 위치 EMA 계수(인식 흔들림 완화)
    sideBand: 0.16,       // |dx| 가 이 값(얼굴 너비 배수)보다 크면 어금니 구역
    rowBand: 0.015,       // |dy| 가 이 값(얼굴 높이 배수)보다 작으면 이전 위/아래 유지
    zoneHold: 0.35,       // 새 구역으로 바꾸기 전 유지해야 하는 시간(초)
    strokeRatio: 1.6,     // 세로/가로 움직임 비율이 이 이상이면 '위아래', 역수 이하이면 '좌우' 모션
  };

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const len = (a) => Math.hypot(a.x, a.y);
  const dist = (a, b) => len(sub(a, b));
  const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };

  function mouthInfo(face) {
    const center = mid(face[FACE.lipTop], face[FACE.lipBottom]);
    const width = dist(face[FACE.mouthL], face[FACE.mouthR]);
    const faceW = dist(face[FACE.cheekL], face[FACE.cheekR]) || 1e-6;
    const faceH = dist(face[FACE.forehead], face[FACE.chin]) || 1e-6;
    const open = dist(face[FACE.lipTop], face[FACE.lipBottom]) / (width || 1e-6);
    return { center, width, faceW, faceH, open };
  }

  // 주먹 쥔 손에서 칫솔 머리 위치 추정: 손잡이는 새끼손가락 쪽에서 엄지·검지 쪽으로 손바닥을 가로지른다.
  function estimateBrushHead(hand, faceW, opts) {
    const grip = mid(hand[HAND.indexMcp], hand[HAND.pinkyMcp]);
    const dir = norm(sub(hand[HAND.indexMcp], hand[HAND.pinkyMcp]));
    const head = add(grip, mul(dir, faceW * opts.handleLen));
    return { grip, dir, head };
  }

  function classify(dx, dy, prevRow, opts) {
    const col = dx < -opts.sideBand ? 'right' : dx > opts.sideBand ? 'left' : 'front';
    let row = dy < -opts.rowBand ? 'upper' : dy > opts.rowBand ? 'lower' : prevRow || 'upper';
    return { col, row, zone: (row === 'upper' ? 'U' : 'L') + (col === 'right' ? 'R' : col === 'left' ? 'L' : 'A') };
  }

  function createAnalyzer(options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    let prev = null;           // { row, zone }
    let candidate = null;      // { zone, since }
    let hist = [];             // 최근 시간 창 안의 { t, grip, head }

    function reset() { prev = null; candidate = null; hist = []; }

    // 시간 창 안의 움직임 요약: 손이 움직인 폭(가로/세로 범위), 평균 머리 위치, 모션 방향
    // 이동 거리 합 대신 범위를 쓰면 인식 흔들림(작은 떨림)이 누적되어 오판하는 일이 없다.
    function summarize(faceW) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, mx = 0, my = 0;
      for (const h of hist) {
        mx += h.head.x; my += h.head.y;
        if (h.grip.x < minX) minX = h.grip.x; if (h.grip.x > maxX) maxX = h.grip.x;
        if (h.grip.y < minY) minY = h.grip.y; if (h.grip.y > maxY) maxY = h.grip.y;
      }
      const n = hist.length || 1;
      const rx = (maxX - minX) / faceW, ry = (maxY - minY) / faceW;
      const motion = Math.max(rx, ry);
      const ratio = ry / (rx || 1e-6);
      const stroke = motion < opts.minMotion * 0.6 ? null : ratio >= opts.strokeRatio ? 'vertical' : ratio <= 1 / opts.strokeRatio ? 'horizontal' : 'mixed';
      return { motion, meanHead: { x: mx / n, y: my / n }, stroke };
    }

    // face: 468+ 랜드마크 배열 또는 null, hands: 손 랜드마크 배열의 배열, t: 초 단위 시각
    function update(face, hands, t) {
      if (!face) { reset(); return { status: 'noface', zone: null, brushing: false }; }
      const m = mouthInfo(face);
      if (!hands || !hands.length) {
        hist = [];
        return { status: 'nohand', zone: null, brushing: false, mouth: m };
      }
      let best = null;
      for (const h of hands) {
        const e = estimateBrushHead(h, m.faceW, opts);
        const d = dist(e.head, m.center) / m.faceW;
        if (!best || d < best.d) best = { ...e, d };
      }
      const last = hist.length ? hist[hist.length - 1] : null;
      const a = opts.gripSmooth;
      const grip = last ? add(mul(last.grip, 1 - a), mul(best.grip, a)) : best.grip;
      const rawHead = last ? add(mul(last.head, 1 - a), mul(best.head, a)) : best.head;
      hist.push({ t, grip, head: rawHead });
      while (hist.length && t - hist[0].t > opts.window) hist.shift();
      const sum = summarize(m.faceW);
      // 위/아래·좌우 판정은 시간 창 평균 위치로: 앞니를 위아래로 닦을 때 구역이 흔들리지 않는다
      const head = sum.meanHead;
      const near = best.d < opts.nearDist;
      const dx = (head.x - m.center.x) / m.faceW;
      const dy = (head.y - m.center.y) / m.faceH;
      const c = classify(dx, dy, prev && prev.row, opts);

      // 구역 전환에 약간의 지연(히스테리시스)
      let zone = prev && prev.zone;
      if (!zone) { zone = c.zone; candidate = null; }
      else if (c.zone !== zone) {
        if (!candidate || candidate.zone !== c.zone) candidate = { zone: c.zone, since: t };
        else if (t - candidate.since >= opts.zoneHold) { zone = c.zone; candidate = null; }
      } else candidate = null;

      const brushing = near && sum.motion >= opts.minMotion;
      prev = { row: zone[0] === 'U' ? 'upper' : 'lower', zone };
      // 권장 모션: 앞니(A)는 위아래, 어금니(R/L)는 좌우
      const wanted = zone[1] === 'A' ? 'vertical' : 'horizontal';
      const goodStroke = brushing && sum.stroke === wanted;
      return { status: near ? (brushing ? 'brushing' : 'idle') : 'far', zone: near ? zone : null, brushing, head: best.head, grip: best.grip,
        motion: sum.motion, stroke: sum.stroke, wanted, goodStroke, near, mouth: m, dx, dy };
    }

    return { update, reset, opts };
  }

  return { createAnalyzer, mouthInfo, estimateBrushHead, classify, DEFAULTS, FACE, HAND };
});
