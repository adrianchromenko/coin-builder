// The hero's coin field: a handful of gold coins hang in the dark at different depths, turning over slowly
// to show the Coin Nerd on one face and the logo on the other, the same two faces as the builder's turning
// coin. The near ones are sharp, the far ones soft and dim, and the whole field shifts gently with the
// pointer (deeper coins less), with a warm light that follows it. That's all it does: no bouncing, no
// clicks, nothing that competes with the headline. Still under prefers-reduced-motion, asleep off screen.
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
  var FACE = 320; // pre-rendered face texture size

  // ---- the two faces, drawn once ----
  function blank() { var c = document.createElement('canvas'); c.width = c.height = FACE; return c; }
  var front = blank(), back = blank();
  function disc(c) {
    var g = c.getContext('2d'), r = FACE / 2;
    var gold = g.createRadialGradient(r * .68, r * .56, 0, r, r, r * 1.08);
    gold.addColorStop(0, '#FFF3B0'); gold.addColorStop(.32, '#EBC24A'); gold.addColorStop(.72, '#BA871B'); gold.addColorStop(1, '#7A5510');
    g.fillStyle = gold; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
    // reeded edge
    g.strokeStyle = 'rgba(94,63,8,.5)'; g.lineWidth = r * .056; g.setLineDash([r * .0105, r * .015]);
    g.beginPath(); g.arc(r, r, r * .972, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    // raised rim
    var rim = g.createLinearGradient(0, 0, FACE, FACE);
    rim.addColorStop(0, '#FFF8D2'); rim.addColorStop(.45, '#D9A93A'); rim.addColorStop(1, '#5E3F08');
    g.strokeStyle = rim; g.lineWidth = r * .032; g.beginPath(); g.arc(r, r, r * .926, 0, Math.PI * 2); g.stroke();
    // the field dips toward the rim
    var well = g.createRadialGradient(r, r, r * .64, r, r, r * .91);
    well.addColorStop(0, 'rgba(60,38,4,0)'); well.addColorStop(1, 'rgba(60,38,4,.3)');
    g.fillStyle = well; g.beginPath(); g.arc(r, r, r * .91, 0, Math.PI * 2); g.fill();
    // beads
    g.strokeStyle = 'rgba(255,243,176,.6)'; g.lineWidth = r * .016; g.lineCap = 'round'; g.setLineDash([.1, r * .04]);
    g.beginPath(); g.arc(r, r, r * .874, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    return g;
  }
  function arcText(g, text, radius, top) {
    var r = FACE / 2;
    g.save(); g.translate(r, r);
    g.font = '600 ' + Math.round(FACE * .066) + 'px Oswald, "Arial Narrow", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#6A480B'; g.strokeStyle = 'rgba(255,243,176,.45)'; g.lineWidth = 1;
    var chars = text.split(''), step = FACE * .052 / radius, total = step * (chars.length - 1);
    for (var i = 0; i < chars.length; i++) {
      var a = (top ? -Math.PI / 2 : Math.PI / 2) + (top ? 1 : -1) * (-total / 2 + i * step);
      g.save(); g.rotate(a); g.translate(0, top ? -radius : radius); g.rotate(top ? 0 : Math.PI);
      g.strokeText(chars[i], 0, 0); g.fillText(chars[i], 0, 0); g.restore();
    }
    g.restore();
  }
  // Each face in a few sizes, halved step by step so small coins stay smooth, plus a soft copy for the far ones.
  var levels = { front: [], back: [], frontSoft: [], backSoft: [] };
  function mips(src) {
    var out = [{ size: FACE, img: src }], size = FACE, img = src;
    while (size > 40) {
      var next = document.createElement('canvas'); next.width = next.height = size / 2;
      next.getContext('2d').drawImage(img, 0, 0, size / 2, size / 2);
      out.push({ size: size / 2, img: next }); size /= 2; img = next;
    }
    return out;
  }
  function soften(src) {
    var c = document.createElement('canvas'); c.width = c.height = FACE; var g = c.getContext('2d');
    if ('filter' in g) { g.filter = 'blur(' + FACE * .012 + 'px)'; g.drawImage(src, 0, 0); g.filter = 'none'; }
    else g.drawImage(src, 0, 0);
    return c;
  }
  function pick(set, px) { for (var i = set.length - 1; i >= 0; i--) if (set[i].size >= px) return set[i].img; return set[0].img; }
  function finishFaces() {
    levels.front = mips(front); levels.back = mips(back);
    levels.frontSoft = mips(soften(front)); levels.backSoft = mips(soften(back));
    if (reduce) frame(0);
  }
  function buildFaces() {
    var gf = disc(front), gb = disc(back), r = FACE / 2;
    arcText(gf, 'COINS FOR ANYTHING', r * .7, true); arcText(gf, '★ VETERAN OWNED ★', r * .72, false);
    arcText(gb, '★ EST. 2002 ★', r * .7, true); arcText(gb, '★ THE QUALITY IS ALWAYS HERE ★', r * .72, false);
    // front: the Coin Nerd set into the metal like an enamel portrait
    gf.fillStyle = 'rgba(60,38,4,.4)'; gf.beginPath(); gf.arc(r, r * 1.025, r * .475, 0, Math.PI * 2); gf.fill();
    gf.fillStyle = '#FFF9EA'; gf.beginPath(); gf.arc(r, r * 1.01, r * .45, 0, Math.PI * 2); gf.fill();
    var nerd = new Image(), logo = new Image(), left = 2;
    function done() { if (--left) return; finishFaces(); }
    nerd.onload = function () {
      gf.save(); gf.beginPath(); gf.arc(r, r * 1.01, r * .43, 0, Math.PI * 2); gf.clip();
      gf.drawImage(nerd, r * .55, r * .56, r * .9, r * .9); gf.restore();
      gf.strokeStyle = '#F58220'; gf.lineWidth = r * .018; gf.beginPath(); gf.arc(r, r * 1.01, r * .43, 0, Math.PI * 2); gf.stroke();
      done();
    };
    logo.onload = function () { gb.drawImage(logo, r * .17, r * .647, r * 1.66, r * .725); done(); };
    nerd.onerror = logo.onerror = done;
    nerd.src = 'brand/coinnerd-coin.webp'; logo.src = 'brand/logo-coin.webp';
  }
  // a soft warm halo, drawn once and placed behind the near coins (cheaper than a shadow every frame)
  var halo = document.createElement('canvas'); halo.width = halo.height = 256;
  (function () {
    var g = halo.getContext('2d'), grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(245,160,60,.5)'); grad.addColorStop(.45, 'rgba(245,130,32,.16)'); grad.addColorStop(1, 'rgba(245,130,32,0)');
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
      r: r, depth: depth, alpha: .2 + depth * .6,
      angle: rand(0, Math.PI * 2), spin: rand(.16, .34) * (Math.random() < .5 ? -1 : 1),
      tilt: rand(-.35, .35), vy: -(2.5 + depth * 5), bob: rand(0, Math.PI * 2), bobAmp: 3 + depth * 5,
    };
  }
  function populate() {
    var n = Math.round(Math.min(16, Math.max(7, (W * H) / 62000)));
    coins = []; for (var i = 0; i < n; i++) coins.push(makeCoin(i, n, false));
    coins.sort(function (a, b) { return a.depth - b.depth; }); // far ones drawn first
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
    var cos = Math.cos(c.angle), ax = Math.abs(cos);
    var soft = c.depth < .4;
    var set = cos >= 0 ? (soft ? levels.frontSoft : levels.front) : (soft ? levels.backSoft : levels.back);
    if (!set.length) return;
    var face = pick(set, c.r * 2 * DPR);
    var shift = pointer.glow * .028 * (c.depth * c.depth + .1);
    var cx = c.x + (pointer.x - W / 2) * shift;
    var cy = c.y + Math.sin(c.bob) * c.bobAmp + (pointer.y - H / 2) * shift;
    ctx.save();
    ctx.translate(cx, cy);
    if (c.depth > .55) { // warm halo behind the near coins
      var hs = c.r * 3.2;
      ctx.globalAlpha = (c.depth - .55) * .9;
      ctx.drawImage(halo, -hs / 2, -hs / 2, hs, hs);
    }
    ctx.globalAlpha = c.alpha;
    ctx.rotate(c.tilt);
    // the thickness: a darker band peeking out on the side turning away
    var sin = Math.abs(Math.sin(c.angle)), thick = c.r * .11 * sin;
    if (thick > .4) {
      var edge = ctx.createLinearGradient(0, -c.r, 0, c.r);
      edge.addColorStop(0, '#5E3F08'); edge.addColorStop(.5, '#A8781E'); edge.addColorStop(1, '#5E3F08');
      ctx.fillStyle = edge;
      ctx.beginPath(); ctx.ellipse(cos >= 0 ? -thick : thick, 0, Math.max(.6, c.r * ax) + thick * .25, c.r, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (ax > .03) {
      ctx.scale(ax, 1);
      ctx.drawImage(face, -c.r, -c.r, c.r * 2, c.r * 2);
      // a slow sheen that crosses the face now and then
      var g = ((time * .16 + c.bob) % 3) - .6;
      if (g > -.3 && g < 1.3) {
        var clamp = function (v) { return Math.min(1, Math.max(0, v)); };
        var grad = ctx.createLinearGradient(-c.r, 0, c.r, 0);
        grad.addColorStop(clamp(g - .3), 'rgba(255,255,255,0)'); grad.addColorStop(clamp(g), 'rgba(255,255,255,.22)'); grad.addColorStop(clamp(g + .3), 'rgba(255,255,255,0)');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, c.r * .93, 0, Math.PI * 2); ctx.fill();
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
        if (c.y < -c.r * 1.3) { var n = makeCoin(0, 1, true); n.depth = c.depth; n.r = c.r; n.alpha = c.alpha; n.vy = c.vy; coins[i] = n; c = n; }
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
  buildFaces(); resize(); start();
})();
