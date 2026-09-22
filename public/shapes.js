/* Coin shapes for the builder.
 *
 * Every preset is an outline in "unit" coordinates: a shape that fits in a circle of radius 1 around (0,0).
 * The preview scales it about its center to draw the raised rim, the field and the border as nested copies.
 * `inner` / `cy` say where a circle of content (logo and lettering) fits inside the field.
 *
 * "artwork" is different: the outline is traced from the customer's own design (logo plus lettering), padded by a
 * rim, so the coin is cut to their artwork. traceArtwork() does that with a canvas: stamp the design, dilate it,
 * smooth it, then walk the boundary of the biggest blob.
 */
(() => {
  'use strict';

  const R = 470; // outer radius of the coin in the 1024-unit layout (matches the round coin)

  // ---------- outline helpers ----------
  const poly = (n, rot, r = 1) => Array.from({ length: n }, (_, i) => { const a = rot + (i * 2 * Math.PI) / n; return [Math.cos(a) * r, Math.sin(a) * r]; });
  const star = (spikes, innerR) => Array.from({ length: spikes * 2 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / spikes; const r = i % 2 ? innerR : 1; return [Math.cos(a) * r, Math.sin(a) * r]; });

  // Polygon with rounded corners as path segments: [['M',x,y], ['L',x,y], ['Q',cx,cy,x,y], ['Z']]
  function rounded(points, radius) {
    const n = points.length;
    const segs = [];
    const towards = (from, to, d) => { const dx = to[0] - from[0], dy = to[1] - from[1]; const len = Math.hypot(dx, dy) || 1; const r = Math.min(d, len / 2); return [from[0] + (dx / len) * r, from[1] + (dy / len) * r]; };
    for (let i = 0; i < n; i++) {
      const p = points[i], prev = points[(i + n - 1) % n], next = points[(i + 1) % n];
      const a = towards(p, prev, radius), b = towards(p, next, radius);
      segs.push(i ? ['L', a[0], a[1]] : ['M', a[0], a[1]]);
      segs.push(['Q', p[0], p[1], b[0], b[1]]);
    }
    segs.push(['Z']);
    return segs;
  }

  // ---------- presets ----------
  // inner: radius of the content circle (fraction of R) inside the field; cy: its center's vertical offset (fraction of R)
  const PRESETS = {
    shield: {
      label: 'Shield', inner: 0.6, cy: -0.1,
      segs: [['M', -0.86, -0.82], ['L', 0.86, -0.82], ['L', 0.86, 0.08], ['C', 0.86, 0.52, 0.5, 0.82, 0, 0.98], ['C', -0.5, 0.82, -0.86, 0.52, -0.86, 0.08], ['Z']],
      icon: 'M4 3h16v8c0 4.5-3.6 7.4-8 10-4.4-2.6-8-5.5-8-10z',
    },
    star: { label: 'Star', inner: 0.4, cy: 0.04, segs: rounded(star(5, 0.55), 0.07), icon: 'M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.4 5.8 21l1.6-7L2 9.3l7.1-.7z' },
    hexagon: { label: 'Hexagon', inner: 0.7, cy: 0, segs: rounded(poly(6, -Math.PI / 2), 0.12), icon: 'M12 2l8.7 5v10L12 22l-8.7-5V7z' },
    octagon: { label: 'Octagon', inner: 0.74, cy: 0, segs: rounded(poly(8, Math.PI / 8), 0.1), icon: 'M7.8 2h8.4L22 7.8v8.4L16.2 22H7.8L2 16.2V7.8z' },
    square: { label: 'Square', inner: 0.7, cy: 0, segs: rounded([[-0.84, -0.84], [0.84, -0.84], [0.84, 0.84], [-0.84, 0.84]], 0.32), icon: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z' },
    heart: {
      label: 'Heart', inner: 0.5, cy: -0.12,
      segs: [['M', 0, 0.95], ['C', -0.55, 0.55, -1.02, 0.15, -0.98, -0.35], ['C', -0.95, -0.75, -0.55, -0.98, -0.25, -0.82], ['C', -0.1, -0.74, 0, -0.6, 0, -0.5], ['C', 0, -0.6, 0.1, -0.74, 0.25, -0.82], ['C', 0.55, -0.98, 0.95, -0.75, 0.98, -0.35], ['C', 1.02, 0.15, 0.55, 0.55, 0, 0.95], ['Z']],
      icon: 'M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11z',
    },
    arrowhead: { label: 'Arrowhead', inner: 0.36, cy: 0.1, segs: rounded([[0, -1], [0.86, 0.72], [0, 0.45], [-0.86, 0.72]], 0.1), icon: 'M12 2l9 17-9-4-9 4z' },
    dogtag: { label: 'Dog tag', inner: 0.5, cy: 0.04, segs: rounded([[-0.64, -0.98], [0.64, -0.98], [0.64, 0.98], [-0.64, 0.98]], 0.4), icon: 'M8 2h8a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z' },
  };

  // Path data for a preset scaled by `s` about its center, in layout pixels
  function presetPath(key, s = 1) {
    const def = PRESETS[key];
    if (!def) return '';
    const px = (x, y) => `${(512 + x * R * s).toFixed(1)} ${(512 + y * R * s).toFixed(1)}`;
    return def.segs.map((seg) => {
      const [c, ...v] = seg;
      const pts = [];
      for (let i = 0; i < v.length; i += 2) pts.push(px(v[i], v[i + 1]));
      return c + (pts.length ? ' ' + pts.join(' ') : '');
    }).join(' ');
  }

  // ---------- "cut to my artwork" ----------
  const GRID = 4; // mask cells are 4 layout pixels; boundaries come out at that resolution and are then smoothed

  function loadImage(src) {
    return new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; });
  }

  // Draw the design's solid parts (logo alpha + lettering) as black on a transparent 1024 canvas
  async function stampDesign(items) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    for (const it of items) {
      if (it.type === 'image') {
        const img = await loadImage(it.src);
        if (img) ctx.drawImage(img, it.x, it.y, it.w, it.h);
      } else if (it.type === 'text') {
        ctx.font = it.font;
        ctx.textAlign = 'center';
        ctx.fillText(it.text, it.x, it.y);
      }
    }
    return c;
  }

  // Grow the stamped design by `margin` pixels (a ring of offset copies), soften the result, and threshold it
  function dilateToGrid(stamp, margin, blur) {
    const d = document.createElement('canvas');
    d.width = 1024; d.height = 1024;
    const ctx = d.getContext('2d');
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      ctx.drawImage(stamp, Math.cos(a) * margin, Math.sin(a) * margin);
    }
    for (let i = 0; i < steps; i++) { // a second, tighter ring so the ring of copies has no gaps between them
      const a = (i / steps) * 2 * Math.PI + Math.PI / steps;
      ctx.drawImage(stamp, Math.cos(a) * margin * 0.55, Math.sin(a) * margin * 0.55);
    }
    ctx.drawImage(stamp, 0, 0);
    const e = document.createElement('canvas');
    e.width = 1024; e.height = 1024;
    const ectx = e.getContext('2d', { willReadFrequently: true });
    if ('filter' in ectx) ectx.filter = `blur(${blur}px)`;
    ectx.drawImage(d, 0, 0);
    const n = 1024 / GRID;
    const px = ectx.getImageData(0, 0, 1024, 1024).data;
    const grid = new Uint8Array(n * n);
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      const x = gx * GRID + GRID / 2, y = gy * GRID + GRID / 2;
      grid[gy * n + gx] = px[(y * 1024 + x) * 4 + 3] > 110 ? 1 : 0;
    }
    return { grid, n };
  }

  // Keep only the biggest connected blob (a stray dot must not become a second coin)
  function largestBlob({ grid, n }) {
    const seen = new Uint8Array(n * n);
    let best = null;
    for (let s = 0; s < n * n; s++) {
      if (!grid[s] || seen[s]) continue;
      const cells = [];
      const stack = [s]; seen[s] = 1;
      while (stack.length) {
        const i = stack.pop(); cells.push(i);
        const x = i % n, y = (i - x) / n;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = ny * n + nx;
          if (grid[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      if (!best || cells.length > best.length) best = cells;
    }
    const out = new Uint8Array(n * n);
    if (best) for (const i of best) out[i] = 1;
    return { grid: out, n, area: best ? best.length : 0 };
  }

  // Walk around the outside of the blob along the cell edges, keeping the blob on the right hand: a closed polygon
  // of grid corners. Diagonal neighbours count as connected, which is what a die-cut outline wants.
  function traceBoundary({ grid, n }) {
    const at = (x, y) => x >= 0 && y >= 0 && x < n && y < n && grid[y * n + x] === 1;
    let sx = -1, sy = -1;
    for (let y = 0; y < n && sx < 0; y++) for (let x = 0; x < n; x++) if (at(x, y)) { sx = x; sy = y; break; }
    if (sx < 0) return [];
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E, S, W, N
    // The two cells ahead of a corner when travelling in direction d: [ahead-left, ahead-right]
    const ahead = (x, y, d) => (d === 0 ? [[x, y - 1], [x, y]] : d === 1 ? [[x, y], [x - 1, y]] : d === 2 ? [[x - 1, y], [x - 1, y - 1]] : [[x - 1, y - 1], [x, y - 1]]);
    const pts = [];
    let x = sx, y = sy, d = 0; // start at the top-left corner of the top-most, left-most cell, heading east along its top edge
    const limit = n * n * 4;
    for (let step = 0; step < limit; step++) {
      pts.push([x, y]);
      x += DIRS[d][0]; y += DIRS[d][1];
      const [l, r] = ahead(x, y, d);
      if (at(l[0], l[1])) d = (d + 3) % 4;      // blob continues on the left: turn left
      else if (!at(r[0], r[1])) d = (d + 1) % 4; // nothing ahead: turn right
      if (x === sx && y === sy && d === 0) break;
    }
    return pts;
  }

  // Chaikin corner cutting: each pass replaces every corner by two points a quarter of the way along its edges
  function smooth(pts, passes) {
    let p = pts;
    for (let k = 0; k < passes; k++) {
      const q = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      p = q;
    }
    return p;
  }

  function toPath(pts) {
    if (pts.length < 3) return '';
    const px = ([x, y]) => `${(x * GRID).toFixed(1)} ${(y * GRID).toFixed(1)}`;
    return 'M ' + pts.map(px).join(' L ') + ' Z';
  }

  /**
   * items: what the design is made of, in layout pixels: { type: 'image', src, x, y, w, h } or { type: 'text', text, x, y, font }.
   * Resolves to { ok, outer, inner, bbox } where outer / inner are path data for the coin's outline and its field,
   * or { ok: false } when the design is too thin or scattered to cut a coin from.
   */
  async function traceArtwork(items, { rim = 64, inset = 34 } = {}) {
    const stamp = await stampDesign(items);
    const outerBlob = largestBlob(dilateToGrid(stamp, rim, 10));
    if (!outerBlob.area) return { ok: false };
    const outerPts = smooth(traceBoundary(outerBlob), 3);
    const innerBlob = largestBlob(dilateToGrid(stamp, rim - inset, 8));
    const innerPts = smooth(traceBoundary(innerBlob), 3);
    // Sanity: the blob must be a reasonable coin. Thin lettering alone gives a long, skinny sliver.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of outerPts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const bw = (x1 - x0) * GRID, bh = (y1 - y0) * GRID;
    const fill = outerBlob.area * GRID * GRID / Math.max(1, bw * bh);
    if (!outerPts.length || !innerPts.length || bw < 200 || bh < 200 || fill < 0.3) return { ok: false };
    return { ok: true, outer: toPath(outerPts), inner: toPath(innerPts), bbox: { x: x0 * GRID, y: y0 * GRID, w: bw, h: bh } };
  }

  window.CoinShapes = { R, PRESETS, presetPath, traceArtwork, _debug: { stampDesign, dilateToGrid, largestBlob, traceBoundary } };
})();
