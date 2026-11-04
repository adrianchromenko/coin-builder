// The hero's coin field: real coins from the gallery (photographed, cut out round) hang in the dark at different
// depths, turning over slowly to show one design on the front and another on the back. The near ones are
// sharp, the far ones soft and dim, and the whole field shifts gently with the pointer (deeper coins less),
// with a warm light that follows it. That's all it does: no bouncing, no clicks, nothing that competes with
// the headline. Still under prefers-reduced-motion, asleep off screen.
(function () {
  'use strict';
  var canvas = document.getElementById('coin-field');
  if (!canvas || !canvas.getContext) return;
  var hero = canvas.parentNode;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, coins = [], running = false, raf = 0, last = 0, t = 0;
  var pointer = { x: 0, y: 0, tx: 0, ty: 0, in: false, glow: 0 };
  var FACE = 360; // the cut-out size

  // ---- the faces: photographed coins, each in a few sizes so small ones stay smooth, plus a soft copy for the far ones ----
  var FILES = ['dover', 'ems', 'citgo', 'texas', 'cirque', 'orange', 'lorian', 'softball'];
  var EDGE = { cirque: ['#8C8C8C', '#D9D9D9', '#5A5A5A'] }; // silver; everything else is gold
  var GOLD = ['#8F6612', '#E2B458', '#5E3F08'];
  var faces = []; // { sharp: [{size,img}], soft: [{size,img}], edge: [dark, light, dark] }
  function mips(src) {
    var out = [{ size: FACE, img: src }], size = FACE, img = src;
    while (size > 44) {
      var next = document.createElement('canvas'); next.width = next.height = Math.round(size / 2);
      next.getContext('2d').drawImage(img, 0, 0, next.width, next.height);
      out.push({ size: next.width, img: next }); size = next.width; img = next;
    }
    return out;
  }
  function soften(src) {
    var c = document.createElement('canvas'); c.width = c.height = FACE; var g = c.getContext('2d');
    if ('filter' in g) { g.filter = 'blur(' + FACE * .011 + 'px)'; g.drawImage(src, 0, 0); g.filter = 'none'; }
    else g.drawImage(src, 0, 0);
    return c;
  }
  function pick(set, px) { for (var i = set.length - 1; i >= 0; i--) if (set[i].size >= px) return set[i].img; return set[0].img; }
  function loadFaces() {
    var left = FILES.length;
    FILES.forEach(function (name) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = c.height = FACE;
        c.getContext('2d').drawImage(img, 0, 0, FACE, FACE);
        faces.push({ sharp: mips(c), soft: mips(soften(c)), edge: EDGE[name] || GOLD });
        if (!--left) { assign(); if (reduce) frame(0); }
      };
      img.onerror = function () { if (!--left) { assign(); if (reduce) frame(0); } };
      img.src = 'hero/' + name + '.webp';
    });
  }
  // a soft warm halo, drawn once and placed behind the near coins (cheaper than a shadow every frame)
  var halo = document.createElement('canvas'); halo.width = halo.height = 256;
  (function () {
    var g = halo.getContext('2d'), grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(245,160,60,.42)'); grad.addColorStop(.45, 'rgba(245,130,32,.14)'); grad.addColorStop(1, 'rgba(245,130,32,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  })();

  // ---- the field ----
  function rand(a, b) { return a + Math.random() * (b - a); }
  function makeCoin(i, n, fresh) {
    var depth = (i + Math.random()) / n; // spread evenly from far to near
    var r = 16 + Math.pow(depth, 1.5) * 66;
    // the text sits on the left on wide screens, so most coins live on the right
    var x = W > 820 ? (Math.random() < .7 ? rand(W * .42, W + r * .4) : rand(-r * .4, W * .42)) : rand(-r * .3, W + r * .3);
    return {
      x: x, y: fresh ? H + r * 1.3 : rand(-r * .5, H + r * .5),
      r: r, depth: depth, alpha: .26 + depth * .56,
      angle: rand(0, Math.PI * 2), spin: rand(.16, .34) * (Math.random() < .5 ? -1 : 1),
      tilt: rand(-.35, .35), vy: -(2.5 + depth * 5), bob: rand(0, Math.PI * 2), bobAmp: 3 + depth * 5,
      front: 0, back: 0,
    };
  }
  function assign() { // each coin gets one design on the front and a different one on the back
    coins.forEach(function (c) {
      c.front = Math.floor(Math.random() * faces.length);
      c.back = faces.length > 1 ? (c.front + 1 + Math.floor(Math.random() * (faces.length - 1))) % faces.length : c.front;
    });
  }
  function populate() {
    var n = Math.round(Math.min(26, Math.max(14, (W * H) / 40000)));
    coins = []; for (var i = 0; i < n; i++) coins.push(makeCoin(i, n, false));
    coins.sort(function (a, b) { return a.depth - b.depth; }); // far ones drawn first
    assign();
  }
  function resize() {
    var rect = hero.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width)); H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    pointer.x = pointer.tx = W / 2; pointer.y = pointer.ty = H / 2;
    populate();
    if (reduce) frame(0);
  }

  function drawCoin(c, time) {
    if (!faces.length) return;
    var cos = Math.cos(c.angle), ax = Math.abs(cos);
    var f = faces[cos >= 0 ? c.front : c.back];
    var soft = c.depth < .4;
    var face = pick(soft ? f.soft : f.sharp, c.r * 2 * DPR);
    var shift = pointer.glow * .028 * (c.depth * c.depth + .1);
    var cx = c.x + (pointer.x - W / 2) * shift;
    var cy = c.y + Math.sin(c.bob) * c.bobAmp + (pointer.y - H / 2) * shift;
    ctx.save();
    ctx.translate(cx, cy);
    if (c.depth > .55) { // warm halo behind the near coins
      var hs = c.r * 3.2;
      ctx.globalAlpha = (c.depth - .55) * .8;
      ctx.drawImage(halo, -hs / 2, -hs / 2, hs, hs);
    }
    ctx.globalAlpha = c.alpha;
    ctx.rotate(c.tilt);
    // the thickness: a metal band peeking out on the side turning away
    var sin = Math.abs(Math.sin(c.angle)), thick = c.r * .1 * sin;
    if (thick > .4) {
      var edge = ctx.createLinearGradient(0, -c.r, 0, c.r);
      edge.addColorStop(0, f.edge[2]); edge.addColorStop(.5, f.edge[1]); edge.addColorStop(1, f.edge[2]);
      ctx.fillStyle = edge;
      ctx.beginPath(); ctx.ellipse(cos >= 0 ? -thick : thick, 0, Math.max(.6, c.r * ax) + thick * .25, c.r, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (ax > .03) {
      ctx.scale(ax, 1);
      ctx.drawImage(face, -c.r, -c.r, c.r * 2, c.r * 2);
      // light from the upper left: a touch brighter there, a touch darker toward the lower right
      var lit = ctx.createLinearGradient(-c.r, -c.r, c.r, c.r);
      lit.addColorStop(0, 'rgba(255,255,255,.14)'); lit.addColorStop(.5, 'rgba(255,255,255,0)'); lit.addColorStop(1, 'rgba(0,0,0,.22)');
      ctx.fillStyle = lit; ctx.beginPath(); ctx.arc(0, 0, c.r, 0, Math.PI * 2); ctx.fill();
      // a slow sheen that crosses the face now and then
      var g = ((time * .16 + c.bob) % 3) - .6;
      if (g > -.3 && g < 1.3) {
        var clamp = function (v) { return Math.min(1, Math.max(0, v)); };
        var grad = ctx.createLinearGradient(-c.r, 0, c.r, 0);
        grad.addColorStop(clamp(g - .3), 'rgba(255,255,255,0)'); grad.addColorStop(clamp(g), 'rgba(255,255,255,.2)'); grad.addColorStop(clamp(g + .3), 'rgba(255,255,255,0)');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, c.r * .97, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  function frame(now) {
    var dt = Math.min(.05, (now - last) / 1000 || .016); last = now; t += dt;
    // the pointer eases toward the mouse; its light fades in and out rather than snapping
    pointer.x += (pointer.tx - pointer.x) * .045; pointer.y += (pointer.ty - pointer.y) * .045;
    pointer.glow += ((pointer.in ? 1 : 0) - pointer.glow) * .04;
    ctx.clearRect(0, 0, W, H);
    if (pointer.glow > .01) {
      var R = 380;
      var lamp = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, R);
      lamp.addColorStop(0, 'rgba(245,130,32,' + (.13 * pointer.glow).toFixed(3) + ')');
      lamp.addColorStop(.5, 'rgba(245,130,32,' + (.045 * pointer.glow).toFixed(3) + ')');
      lamp.addColorStop(1, 'rgba(245,130,32,0)');
      ctx.fillStyle = lamp; ctx.fillRect(pointer.x - R, pointer.y - R, R * 2, R * 2);
    }
    for (var i = 0; i < coins.length; i++) {
      var c = coins[i];
      if (!reduce) {
        c.bob += dt * .5;
        c.y += c.vy * dt;
        c.angle += c.spin * dt;
        if (c.y < -c.r * 1.3) {
          var n = makeCoin(0, 1, true); n.depth = c.depth; n.r = c.r; n.alpha = c.alpha; n.vy = c.vy; n.front = c.front; n.back = c.back;
          coins[i] = n; c = n;
        }
      }
      drawCoin(c, t);
    }
    if (running && !reduce) raf = requestAnimationFrame(frame);
  }
  function start() { if (running || reduce) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // ---- input: mouse only; on a phone the field simply drifts ----
  hero.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var r = canvas.getBoundingClientRect(); pointer.tx = e.clientX - r.left; pointer.ty = e.clientY - r.top; pointer.in = true;
  });
  hero.addEventListener('pointerleave', function () { pointer.in = false; pointer.tx = W / 2; pointer.ty = H / 2; });

  // ---- lifecycle ----
  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible && !document.hidden) start(); else stop(); }, { threshold: 0 }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (visible) start(); });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 120); });
  loadFaces(); resize(); start();
})();
