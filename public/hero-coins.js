// The hero's coin field: gold coins at different depths drift up through the dark, turning over to show the
// Coin Nerd on one face and the logo on the other, the same two faces as the builder's turning coin.
// The pointer parts them as it moves (and the field shifts with it, deeper coins less), and a click or tap
// sends a ring out that spins the coins it passes. Nothing here blocks reading: the canvas sits behind the
// hero text under a dark gradient, respects prefers-reduced-motion (one still frame), and sleeps while the
// hero is off screen or the tab is hidden.
(function () {
  'use strict';
  var canvas = document.getElementById('coin-field');
  if (!canvas || !canvas.getContext) return;
  var hero = canvas.parentNode;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, coins = [], ripples = [], running = false, raf = 0, last = 0, t = 0;
  var pointer = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, in: false };
  var FACE = 256; // pre-rendered face texture size

  // ---- the two faces, drawn once ----
  var front = document.createElement('canvas'), back = document.createElement('canvas');
  front.width = front.height = back.width = back.height = FACE;
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
  var facesReady = false;
  function buildFaces() {
    var gf = disc(front), gb = disc(back), r = FACE / 2;
    arcText(gf, 'COINS FOR ANYTHING', r * .7, true); arcText(gf, '★ VETERAN OWNED ★', r * .72, false);
    arcText(gb, '★ EST. 2002 ★', r * .7, true); arcText(gb, '★ THE QUALITY IS ALWAYS HERE ★', r * .72, false);
    // front: the Coin Nerd set into the metal like an enamel portrait
    gf.fillStyle = 'rgba(60,38,4,.4)'; gf.beginPath(); gf.arc(r, r * 1.025, r * .475, 0, Math.PI * 2); gf.fill();
    gf.fillStyle = '#FFF9EA'; gf.beginPath(); gf.arc(r, r * 1.01, r * .45, 0, Math.PI * 2); gf.fill();
    var nerd = new Image(), logo = new Image(), left = 2;
    function done() { if (--left) return; facesReady = true; if (reduce) frame(0); }
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

  // ---- the field ----
  function rand(a, b) { return a + Math.random() * (b - a); }
  function makeCoin(fresh) {
    var depth = Math.random(); // 0 far, 1 near
    var r = 14 + depth * depth * 60;
    return {
      x: rand(-r, W + r), y: fresh ? H + r + rand(0, H * .4) : rand(-r, H + r),
      r: r, depth: depth, alpha: .34 + depth * .56,
      angle: rand(0, Math.PI * 2), spin: rand(.35, .9) * (Math.random() < .5 ? -1 : 1), kick: 0,
      tilt: rand(-.45, .45), vy: -(6 + depth * 16), sway: rand(0, Math.PI * 2), swayAmp: rand(6, 18),
      vx: 0, px: 0, py: 0, // push from the pointer, decays
    };
  }
  function populate() {
    var n = Math.round(Math.min(46, Math.max(14, (W * H) / 27000)));
    coins = []; for (var i = 0; i < n; i++) coins.push(makeCoin(false));
    coins.sort(function (a, b) { return a.depth - b.depth; }); // far ones drawn first
  }
  function resize() {
    var rect = hero.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width)); H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    populate();
    if (reduce) frame(0);
  }

  function drawCoin(c, time) {
    var cos = Math.cos(c.angle), ax = Math.abs(cos);
    var face = cos >= 0 ? front : back;
    var cx = c.x + c.px + (pointer.in ? (pointer.x - W / 2) * .035 * c.depth : 0);
    var cy = c.y + c.py + Math.sin(c.sway) * c.swayAmp * .3 + (pointer.in ? (pointer.y - H / 2) * .035 * c.depth : 0);
    ctx.save();
    ctx.globalAlpha = c.alpha;
    ctx.translate(cx, cy); ctx.rotate(c.tilt);
    // the thickness: a darker ellipse peeking out on the side turning away
    var thick = c.r * .12 * Math.abs(Math.sin(c.angle));
    if (thick > .5) {
      ctx.fillStyle = '#8F6612';
      ctx.beginPath(); ctx.ellipse(cos >= 0 ? -thick : thick, 0, Math.max(.5, c.r * ax) + thick * .2, c.r, 0, 0, Math.PI * 2); ctx.fill();
    }
    // glow behind the near coins
    if (c.depth > .6) { ctx.shadowColor = 'rgba(245,130,32,.35)'; ctx.shadowBlur = c.r * .6; }
    ctx.scale(Math.max(ax, .02), 1);
    ctx.drawImage(face, -c.r, -c.r, c.r * 2, c.r * 2);
    ctx.shadowBlur = 0;
    // a glint that crosses the face as it turns
    var g = ((time * .35 + c.sway) % 2) - .5; // runs from off the left edge to off the right, then rests
    if (g > -.18 && g < 1.18) {
      var clamp = function (v) { return Math.min(1, Math.max(0, v)); };
      var grad = ctx.createLinearGradient(-c.r, 0, c.r, 0);
      grad.addColorStop(clamp(g - .18), 'rgba(255,255,255,0)'); grad.addColorStop(clamp(g), 'rgba(255,255,255,.45)'); grad.addColorStop(clamp(g + .18), 'rgba(255,255,255,0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, c.r * .93, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function frame(now) {
    var dt = Math.min(.05, (now - last) / 1000 || .016); last = now; t += dt;
    // the pointer eases toward where the finger or mouse is
    pointer.x += (pointer.tx - pointer.x) * .12; pointer.y += (pointer.ty - pointer.y) * .12;
    ctx.clearRect(0, 0, W, H);
    // a warm light that follows the pointer, so the coins near it catch the glow
    if (pointer.in) {
      var lamp = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 300);
      lamp.addColorStop(0, 'rgba(245,130,32,.22)'); lamp.addColorStop(.5, 'rgba(245,130,32,.07)'); lamp.addColorStop(1, 'rgba(245,130,32,0)');
      ctx.fillStyle = lamp; ctx.fillRect(pointer.x - 300, pointer.y - 300, 600, 600);
    }
    for (var i = 0; i < coins.length; i++) {
      var c = coins[i];
      if (!reduce) {
        c.sway += dt * .9;
        c.y += c.vy * dt; c.x += c.vx * dt;
        c.angle += (c.spin + c.kick) * dt; c.kick *= Math.pow(.25, dt);
        // the pointer parts the coins
        if (pointer.in) {
          var dx = c.x + c.px - pointer.x, dy = c.y + c.py - pointer.y, d = Math.hypot(dx, dy), reach = 120 + c.r;
          if (d < reach && d > .1) { var f = (1 - d / reach) * 260 * dt; c.px += dx / d * f; c.py += dy / d * f; c.kick += (1 - d / reach) * 1.2 * dt * 60 * .2; }
        }
        c.px *= Math.pow(.08, dt); c.py *= Math.pow(.08, dt);
        if (c.y < -c.r - 10) { var n = makeCoin(true); n.depth = c.depth; n.r = c.r; n.alpha = c.alpha; coins[i] = n; c = n; }
      }
      drawCoin(c, t);
    }
    // ripples from clicks
    for (var k = ripples.length - 1; k >= 0; k--) {
      var rp = ripples[k]; rp.age += dt; var rr = rp.age * 520, life = 1 - rp.age / .9;
      if (life <= 0) { ripples.splice(k, 1); continue; }
      ctx.save(); ctx.globalAlpha = life * .55; ctx.strokeStyle = '#F5B04C'; ctx.lineWidth = 2 + life * 3;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rr, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      for (var j = 0; j < coins.length; j++) {
        var q = coins[j], dd = Math.hypot(q.x - rp.x, q.y - rp.y);
        if (!q.hit && dd < rr && dd > rr - 60) { q.hit = rp; q.kick += 9 * (Math.random() < .5 ? -1 : 1); var ux = (q.x - rp.x) / (dd || 1), uy = (q.y - rp.y) / (dd || 1); q.px += ux * 26; q.py += uy * 26; }
        else if (q.hit === rp && dd > rr) q.hit = null;
      }
    }
    if (running && !reduce) raf = requestAnimationFrame(frame);
  }
  function start() { if (running || reduce) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // ---- input ----
  function point(e) { var r = canvas.getBoundingClientRect(); var p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; }
  hero.addEventListener('pointermove', function (e) { var p = point(e); pointer.tx = p.x; pointer.ty = p.y; if (!pointer.in) { pointer.x = p.x; pointer.y = p.y; } pointer.in = true; });
  hero.addEventListener('pointerleave', function () { pointer.in = false; pointer.tx = -1e4; pointer.ty = -1e4; });
  hero.addEventListener('pointerdown', function (e) {
    if (e.target.closest('a, button')) return; // the buttons keep their click
    var p = point(e); ripples.push({ x: p.x, y: p.y, age: 0 });
    if (reduce) frame(performance.now());
  });
  hero.addEventListener('touchmove', function (e) { var p = point(e); pointer.tx = p.x; pointer.ty = p.y; pointer.in = true; }, { passive: true });
  hero.addEventListener('touchend', function () { pointer.in = false; pointer.tx = -1e4; pointer.ty = -1e4; }, { passive: true });

  // ---- lifecycle ----
  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible && !document.hidden) start(); else stop(); }, { threshold: 0 }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (visible) start(); });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 120); });
  buildFaces(); resize(); start();
})();
