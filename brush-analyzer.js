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
    minSpeed: 0.5,        // 손 움직임 속도(얼굴 너비/초) 최소값. 이보다 빠르게 흔들려야 "닦는 중"
    sideBand: 0.16,       // |dx| 가 이 값(얼굴 너비 배수)보다 크면 어금니 구역
    rowBand: 0.015,       // |dy| 가 이 값(얼굴 높이 배수)보다 작으면 이전 위/아래 유지
    smooth: 0.35,         // 칫솔 머리 위치 EMA 계수
    zoneHold: 0.35,       // 새 구역으로 바꾸기 전 유지해야 하는 시간(초)
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
    let prev = null;           // { grip, head(smoothed), row, zone, t }
    let candidate = null;      // { zone, since }

    function reset() { prev = null; candidate = null; }

    // face: 468+ 랜드마크 배열 또는 null, hands: 손 랜드마크 배열의 배열, t: 초 단위 시각
    function update(face, hands, t) {
      if (!face) { reset(); return { status: 'noface', zone: null, brushing: false }; }
      const m = mouthInfo(face);
      if (!hands || !hands.length) {
        prev = prev ? { ...prev, grip: null } : null;
        return { status: 'nohand', zone: null, brushing: false, mouth: m };
      }
      let best = null;
      for (const h of hands) {
        const e = estimateBrushHead(h, m.faceW, opts);
        const d = dist(e.head, m.center) / m.faceW;
        if (!best || d < best.d) best = { ...e, d };
      }
      let head = best.head;
      if (prev && prev.head) head = add(mul(prev.head, 1 - opts.smooth), mul(best.head, opts.smooth));
      const dt = prev && prev.t != null ? Math.max(1e-3, t - prev.t) : null;
      const speed = prev && prev.grip && dt ? dist(best.grip, prev.grip) / dt / m.faceW : 0;
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

      const brushing = near && speed >= opts.minSpeed;
      prev = { grip: best.grip, head, row: zone[0] === 'U' ? 'upper' : 'lower', zone, t };
      return { status: near ? (brushing ? 'brushing' : 'idle') : 'far', zone: near ? zone : null, brushing, head, grip: best.grip, speed, near, mouth: m, dx, dy };
    }

    return { update, reset, opts };
  }

  return { createAnalyzer, mouthInfo, estimateBrushHead, classify, DEFAULTS, FACE, HAND };
});
