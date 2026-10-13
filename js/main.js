/* Wet Ink Studio: interactions
   One idea: ink that is still wet. It spreads, pools, runs and dries.
   Motion follows Apple's fluid-interface rules:
   - respond on pointer-down, track 1:1, never lock out input
   - springs (damping ratio + response) that start from the current on-screen value
   - release velocity is handed to the spring; flicks are projected forward
   - soft rubber-band edges; reduced motion swaps travel for cross-fades */
(() => {
  "use strict";

  const root = document.documentElement;
  root.classList.add("js");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ============================================================ physics kit */

  /* Spring described the way Apple's designers tune it:
     damping ratio (1 = no overshoot, <1 = bounce) and response (seconds, not a duration). */
  class Spring {
    constructor(value = 0, { damping = 1, response = .4, precision = .01 } = {}) {
      this.value = this.target = value;
      this.velocity = 0;
      this.precision = precision;
      this.configure(damping, response);
    }
    configure(damping, response) {
      this.damping = damping; this.response = response;
      this.k = Math.pow(2 * Math.PI / response, 2);   // stiffness, unit mass
      this.c = 4 * Math.PI * damping / response;      // damping coefficient
      return this;
    }
    /* Re-target from the current value and velocity: interruptible by construction. */
    to(target, { velocity, damping, response } = {}) {
      if (damping != null || response != null) this.configure(damping ?? this.damping, response ?? this.response);
      if (velocity != null) this.velocity = velocity;
      this.target = target;
      if (reduced) this.jump(target);
    }
    jump(v) { this.value = this.target = v; this.velocity = 0; }
    step(dt) {
      const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;   // fixed sub-steps keep stiff springs stable
      for (let i = 0; i < n; i++) {
        const a = -this.k * (this.value - this.target) - this.c * this.velocity;
        this.velocity += a * h;
        this.value += this.velocity * h;
      }
      if (this.resting) this.jump(this.target);
    }
    get resting() { return Math.abs(this.velocity) < this.precision && Math.abs(this.value - this.target) < this.precision; }
  }

  /* One display-synced clock for everything that moves. A task returns true while it still needs frames. */
  const tasks = new Set();
  let clockOn = false, lastFrame = 0;
  function animate(task) {
    tasks.add(task);
    if (!clockOn) { clockOn = true; lastFrame = performance.now(); requestAnimationFrame(frame); }
  }
  function frame(now) {
    const dt = Math.min(1 / 30, (now - lastFrame) / 1000); lastFrame = now;
    for (const t of tasks) if (!t(dt)) tasks.delete(t);
    if (tasks.size) requestAnimationFrame(frame); else clockOn = false;
  }

  /* Velocity from the last ~80 ms of pointer history, not just the last event. */
  function velocityTracker() {
    const h = [];
    return {
      reset() { h.length = 0; },
      add(x, y, t = performance.now()) { h.push({ x, y, t }); while (h.length > 2 && t - h[0].t > 80) h.shift(); },
      get() {
        if (h.length < 2) return { x: 0, y: 0 };
        const a = h[0], b = h[h.length - 1];
        if (performance.now() - b.t > 60) return { x: 0, y: 0 };   // finger stopped before lifting
        const dt = Math.max(.008, (b.t - a.t) / 1000);
        return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
      }
    };
  }

  /* Apple's momentum projection (exponential decay, like scroll deceleration). */
  const project = (v, rate = .998) => (v / 1000) * rate / (1 - rate);

  /* Progressive resistance past a boundary. */
  const rubberband = (over, dim, c = .55) => (over * dim * c) / (dim + c * Math.abs(over));

  /* Seeded random so every cover renders the same way on every visit */
  const rng = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ========================================================= drying timer */
  const dryEl = $("#dryTimer");
  const t0 = Date.now();
  setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    dryEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  /* ======================================================= hero ink field
     Metaballs: soft circles summed into a low-res alpha field, then thresholded.
     Pixels just over the threshold are painted darker: the rim real ink leaves as it dries. */
  const hero = $(".hero");
  const canvas = $("#inkCanvas");
  const ctx = canvas.getContext("2d");
  const field = document.createElement("canvas");
  const fctx = field.getContext("2d", { willReadFrequently: true });
  const SCALE = 0.5;
  let W = 0, H = 0, particles = [], inkRunning = false, heroVisible = true;

  function sizeInk() {
    const r = hero.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * SCALE));
    H = Math.max(1, Math.round(r.height * SCALE));
    canvas.width = field.width = W;
    canvas.height = field.height = H;
  }
  sizeInk();
  addEventListener("resize", sizeInk);

  const MAX = 460;
  function spawn(p) {
    if (particles.length > MAX) particles.splice(0, particles.length - MAX);
    particles.push(Object.assign({ vx: 0, vy: 0, age: 0, grow: 1.25, life: 2.6, drip: false }, p));
    if (!inkRunning && heroVisible) { inkRunning = true; animate(tickInk); }
  }

  /* A drop inherits the stroke's velocity, so a moving press throws its splash forward. */
  function dropInk(x, y, size = 1, vx = 0, vy = 0) {
    const R = (34 + Math.random() * 30) * size;
    spawn({ x, y, r: R * .35, tr: R, life: 11, grow: 1, vx: vx * .15, vy: vy * .15 });
    const n = 7 + (Math.random() * 7 | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = R * (0.6 + Math.random() * 0.9);
      const sp = 140 + Math.random() * 260;
      spawn({ x: x + Math.cos(a) * d * .3, y: y + Math.sin(a) * d * .3,
              vx: Math.cos(a) * sp * size + vx * .45, vy: Math.sin(a) * sp * size + vy * .45,
              r: 3, tr: (5 + Math.random() * 12) * size, life: 7 + Math.random() * 4, grow: 1 });
    }
    const runs = 1 + (Math.random() < .5 ? 1 : 0);   // one or two runs crawl down the page
    for (let i = 0; i < runs; i++) {
      spawn({ x: x + (Math.random() - .5) * R, y: y + R * .4, vy: 60 + Math.random() * 60,
              r: 8, tr: 9 * size, life: 6 + Math.random() * 3, drip: true, grow: 1 });
    }
  }

  const T = 120, RIM = 18;
  function tickInk(dt) {
    if (!heroVisible) { inkRunning = false; return false; }
    fctx.clearRect(0, 0, W, H);
    fctx.globalCompositeOperation = "lighter";
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;                       // paper soaks up the ink
      p.vx *= Math.pow(.02, dt); p.vy *= p.drip ? Math.pow(.55, dt) : Math.pow(.02, dt);
      if (p.drip && p.vy > 8 && Math.random() < .6) {
        spawn({ x: p.x + (Math.random() - .5) * 2, y: p.y, r: p.r * .8, tr: p.tr * (.75 + Math.random() * .2), life: 4 + Math.random() * 2 });
      }
      const grown = lerp(p.r, p.tr * p.grow, 1 - Math.pow(1 - Math.min(1, p.age * 2.2), 3));
      const rad = grown * (k > .65 ? 1 - (k - .65) / .35 : 1);    // evaporate in the last third
      if (rad <= .5) continue;
      const x = p.x * SCALE, y = p.y * SCALE, R = rad * SCALE * 1.9;
      const g = fctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(.5, "rgba(0,0,0,.5)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      fctx.fillStyle = g;
      fctx.beginPath(); fctx.arc(x, y, R, 0, Math.PI * 2); fctx.fill();
    }
    const src = fctx.getImageData(0, 0, W, H);
    const out = ctx.createImageData(W, H);
    const s = src.data, o = out.data;
    for (let i = 3; i < s.length; i += 4) {
      const a = s[i];
      if (a < T - 14) continue;
      if (a < T) { o[i - 3] = 150; o[i - 2] = 14; o[i - 1] = 10; o[i] = (a - T + 14) * 18; continue; } // soft edge
      if (a < T + RIM) { o[i - 3] = 150; o[i - 2] = 14; o[i - 1] = 10; }                                // dried rim
      else { o[i - 3] = 226; o[i - 2] = 35; o[i - 1] = 26; }                                              // wet red
      o[i] = 255;
    }
    ctx.putImageData(out, 0, 0);
    if (particles.length) return true;
    ctx.clearRect(0, 0, W, H); inkRunning = false; return false;
  }

  new IntersectionObserver(([en]) => {
    heroVisible = en.isIntersecting;
    if (heroVisible && particles.length && !inkRunning) { inkRunning = true; animate(tickInk); }
  }).observe(hero);

  const heroPoint = e => { const r = hero.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const stroke = velocityTracker();
  let lastTrail = null, touchStart = null;

  // Continuous feedback: the pointer draws the whole time it moves (mouse and pen only; touch scrolls).
  hero.addEventListener("pointermove", e => {
    if (e.pointerType === "touch" || mascotState.active) return;
    const p = heroPoint(e);
    stroke.add(p.x, p.y);
    if (reduced) return;
    if (lastTrail) {
      const dx = p.x - lastTrail.x, dy = p.y - lastTrail.y, dist = Math.hypot(dx, dy);
      if (dist < 7) return;
      const speed = clamp(dist / 40, 0, 1);   // fast strokes lay thinner ink, like a dragged brush
      spawn({ x: p.x, y: p.y, r: 4, tr: lerp(22, 9, speed), life: 2.2 + Math.random(), vx: dx * .4, vy: dy * .4 });
    }
    lastTrail = p;
  }, { passive: true });
  hero.addEventListener("pointerleave", () => { lastTrail = null; stroke.reset(); });

  // Respond on press, not on release. Touch waits for the tap to resolve so scrolling never splashes.
  hero.addEventListener("pointerdown", e => {
    if (e.target.closest("button, a")) return;
    const p = heroPoint(e);
    if (e.pointerType === "touch") { touchStart = { ...p, t: performance.now() }; return; }
    const v = stroke.get();
    dropInk(p.x, p.y, reduced ? .8 : 1, v.x, v.y);
  });
  hero.addEventListener("pointerup", e => {
    if (e.pointerType !== "touch" || !touchStart) return;
    const p = heroPoint(e);
    if (Math.hypot(p.x - touchStart.x, p.y - touchStart.y) < 10 && performance.now() - touchStart.t < 500) dropInk(p.x, p.y, .7);
    touchStart = null;
  });
  hero.addEventListener("pointercancel", () => { touchStart = null; });

  if (!finePointer) $("#heroHint").textContent = "Tap to drop ink · Throw Blot";

  // A first drop, so the page shows what it does before anyone touches it.
  setTimeout(() => {
    const r = hero.getBoundingClientRect();
    dropInk(r.width * .8, r.height * .3, clamp(r.width / 1200, .55, 1.2));
  }, reduced ? 100 : 700);

  /* ================================================================ Blot
     A direct-manipulation toy: grab it where you grabbed it, drag it 1:1 with a
     rubber-band leash, throw it. It springs home carrying your release velocity. */
  const mascot = $("#mascot");
  const pupils = $$(".pupil", mascot);
  const mx = new Spring(0, { damping: .55, response: .5, precision: .05 });
  const my = new Spring(reduced ? 0 : -260, { damping: .55, response: .5, precision: .05 });
  const sx = new Spring(1, { damping: .45, response: .3, precision: .001 });
  const sy = new Spring(1, { damping: .45, response: .3, precision: .001 });
  const px = new Spring(0, { damping: 1, response: .18, precision: .005 });
  const py = new Spring(0, { damping: 1, response: .18, precision: .005 });
  const mascotState = { active: false, dragging: false, id: null, start: null, origin: null };
  const mtrack = velocityTracker();

  function renderMascot() {
    mascot.style.transform = `translate3d(${mx.value}px, ${my.value}px, 0) scale(${sx.value}, ${sy.value})`;
    pupils.forEach(p => p.setAttribute("transform", `translate(${px.value.toFixed(2)} ${py.value.toFixed(2)})`));
  }
  const mascotSprings = [mx, my, sx, sy, px, py];
  function mascotTask(dt) {
    mascotSprings.forEach(s => { if (!(mascotState.dragging && (s === mx || s === my))) s.step(dt); });
    renderMascot();
    return mascotState.dragging || mascotSprings.some(s => !s.resting);
  }
  renderMascot();
  // Entrance: it falls into the dot of the i. A fall carries momentum, so it may bounce.
  if (!reduced) setTimeout(() => { my.to(0, { velocity: 900 }); sy.to(1, { velocity: -3 }); animate(mascotTask); }, 250);

  function lookAt(cx, cy, tx, ty) {
    const a = Math.atan2(ty - cy, tx - cx);
    const d = clamp(Math.hypot(tx - cx, ty - cy) / 80, 0, 1) * 2.6;
    px.to(Math.cos(a) * d); py.to(Math.sin(a) * d);
    animate(mascotTask);
  }
  addEventListener("pointermove", e => {
    if (mascotState.dragging || reduced) return;
    const b = mascot.getBoundingClientRect();
    lookAt(b.left + b.width / 2, b.top + b.height * .62, e.clientX, e.clientY);
  }, { passive: true });

  mascot.addEventListener("pointerdown", e => {
    e.preventDefault();
    mascot.setPointerCapture(e.pointerId);
    Object.assign(mascotState, { active: true, dragging: false, id: e.pointerId,
      start: { x: e.clientX, y: e.clientY }, origin: { x: mx.value, y: my.value } });   // presentation value: no jump
    mx.velocity = my.velocity = 0;
    mtrack.reset(); mtrack.add(e.clientX, e.clientY);
    sx.to(1.12, { response: .15, damping: .7 }); sy.to(.88, { response: .15, damping: .7 });   // instant press squish
    animate(mascotTask);
  });

  mascot.addEventListener("pointermove", e => {
    if (!mascotState.active || e.pointerId !== mascotState.id) return;
    const dx = e.clientX - mascotState.start.x, dy = e.clientY - mascotState.start.y;
    if (!mascotState.dragging && Math.hypot(dx, dy) > 10) mascotState.dragging = true;   // hysteresis before committing
    if (!mascotState.dragging) return;
    mtrack.add(e.clientX, e.clientY);
    // free inside the leash, rubber-banded beyond it
    let x = mascotState.origin.x + dx, y = mascotState.origin.y + dy;
    const leash = Math.min(hero.clientWidth * .35, 260), d = Math.hypot(x, y);
    if (d > leash) { const k = (leash + rubberband(d - leash, 320)) / d; x *= k; y *= k; }
    mx.jump(x); my.jump(y);
    // stretch along the direction of travel: speed reads as shape
    const v = mtrack.get(), sp = Math.hypot(v.x, v.y) || 1, st = clamp(sp / 4000, 0, .3);
    sx.to(1 + st * Math.abs(v.x) / sp - st * .5 * Math.abs(v.y) / sp, { response: .12, damping: 1 });
    sy.to(1 + st * Math.abs(v.y) / sp - st * .5 * Math.abs(v.x) / sp, { response: .12, damping: 1 });
    px.to(clamp(v.x / 400, -2.6, 2.6)); py.to(clamp(v.y / 400, -2.6, 2.6));   // looks where it's going
    // Blot is made of ink: it leaves a trail
    const b = mascot.getBoundingClientRect(), h = hero.getBoundingClientRect();
    if (!reduced) spawn({ x: b.left - h.left + b.width / 2, y: b.top - h.top + b.height * .65, r: 4, tr: 10 + b.width * .12, life: 2.4 });
  });

  function releaseMascot(e) {
    if (!mascotState.active || e.pointerId !== mascotState.id) return;
    const wasDrag = mascotState.dragging;
    mascotState.active = mascotState.dragging = false;
    const b = mascot.getBoundingClientRect(), h = hero.getBoundingClientRect();
    const cx = b.left - h.left + b.width / 2, cy = b.top - h.top + b.height * .7;
    if (wasDrag) {
      const v = mtrack.get(), speed = Math.hypot(v.x, v.y);
      // A real throw lands somewhere: splash where the momentum would carry it.
      if (speed > 900) {
        const lx = clamp(cx + project(v.x, .99), 20, h.width - 20), ly = clamp(cy + project(v.y, .99), 20, h.height - 20);
        dropInk(lx, ly, .8, v.x, v.y);
      }
      // Hand the release velocity to the spring: no seam between drag and animation.
      mx.to(0, { velocity: v.x, damping: .55, response: .5 });
      my.to(0, { velocity: v.y, damping: .55, response: .5 });
    } else {
      dropInk(cx, cy + 6, .6);
    }
    sx.to(1, { velocity: wasDrag ? 0 : -4, damping: .4, response: .35 });
    sy.to(1, { velocity: wasDrag ? 0 : 5, damping: .4, response: .35 });
    animate(mascotTask);
  }
  mascot.addEventListener("pointerup", releaseMascot);
  mascot.addEventListener("pointercancel", releaseMascot);
  // keyboard activation (Enter / Space) gets the same tap response
  mascot.addEventListener("click", e => {
    if (e.detail !== 0) return;
    const b = mascot.getBoundingClientRect(), h = hero.getBoundingClientRect();
    dropInk(b.left - h.left + b.width / 2, b.bottom - h.top, .6);
    sy.to(1, { velocity: 5, damping: .4, response: .35 }); sx.to(1, { velocity: -4, damping: .4, response: .35 });
    animate(mascotTask);
  });

  /* ======================================================== ticker
     Drifts slowly; your scroll adds its speed and direction, then eases back. */
  const ticker = $("#ticker");
  const tickVel = new Spring(0, { damping: 1, response: .6, precision: .5 });
  let tickX = 0, tickVisible = false, lastScrollY = scrollY, lastScrollT = performance.now();
  function tickerTask(dt) {
    if (!tickVisible || reduced) return false;
    tickVel.step(dt);
    tickX -= (38 + tickVel.value * .4) * dt;
    const half = ticker.scrollWidth / 2;
    if (tickX <= -half) tickX += half; else if (tickX > 0) tickX -= half;
    ticker.style.transform = `translate3d(${tickX}px, 0, 0)`;
    return true;
  }
  new IntersectionObserver(([en]) => { tickVisible = en.isIntersecting; if (tickVisible) animate(tickerTask); }).observe(ticker);

  /* ======================================================== story chapter (scroll-linked, 1:1) */
  const story = $(".story");
  const stack = $("#stack");
  const drop3d = $("#drop3d");
  const steps = $$("#steps li");
  const lines = $$(".story__line");
  const storyBar = $("#storyBar");
  const discs = Array.from({ length: 5 }, () => {
    const d = document.createElement("div"); d.className = "disc"; stack.insertBefore(d, drop3d); return d;
  });
  let lineIndex = 0;
  function updateStory() {
    const r = story.getBoundingClientRect();
    const p = clamp(-r.top / (r.height - innerHeight), 0, 1);
    const h = stack.clientHeight;
    const spread = clamp(p * 2.2, 0, 1);
    const gap = lerp(10, Math.min(h / 6.2, 110), 1 - Math.pow(1 - spread, 3));
    const spin = p * 220, discY = [];
    discs.forEach((d, i) => {
      const y = (i - 2) * gap; discY.push(y);
      d.style.transform = `translate3d(0, ${y}px, 0) rotateX(72deg) rotateZ(${spin + i * 18}deg)`;
    });
    const top = -2 * gap - h * .32, bottom = 2 * gap + 30;
    const dy = lerp(top, bottom, clamp((p - .12) / .8, 0, 1));
    drop3d.style.transform = `translate3d(0, ${dy}px, 60px)`;
    discs.forEach((d, i) => d.classList.toggle("is-lit", dy > discY[i] - 4));
    steps.forEach((s, i) => s.classList.toggle("is-on", dy > discY[i] - 4 || (i === 0 && p > .02)));
    // Lines sit in order: earlier ones wait above, later ones below. Scrolling back reverses the path.
    const li = Math.min(lines.length - 1, Math.floor(p * lines.length * 1.02));
    if (li !== lineIndex) {
      lineIndex = li;
      lines.forEach((l, i) => { l.style.setProperty("--from", i < li ? "-30%" : "30%"); l.classList.toggle("is-on", i === li); });
    }
    storyBar.style.transform = `scaleX(${p})`;
  }

  /* ======================================================== covers */
  const C = { paper: "#E8E3D6", ink: "#131214", wet: "#E2231A", pink: "#FF48B0", blue: "#0078BF", yellow: "#FFE800", green: "#00A95C" };

  function splatPath(rand, cx, cy, R) {
    const n = 36, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let r = R * (0.78 + rand() * 0.3);
      if (rand() < .16) r *= 1.35 + rand() * .5;   // a splash spike
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p1 = pts[(i + 1) % n], p2 = pts[(i + 2) % n];
      d += `Q${p1[0].toFixed(1)} ${p1[1].toFixed(1)} ${((p1[0] + p2[0]) / 2).toFixed(1)} ${((p1[1] + p2[1]) / 2).toFixed(1)}`;
    }
    return d + "Z";
  }

  function cover(seed, { bg, a, b, glyph, label, style = "splat" }) {
    const rand = rng(seed), id = "h" + seed;
    let shapes = "";
    if (style === "splat") {
      shapes += `<path d="${splatPath(rand, 120 + rand() * 160, 160 + rand() * 180, 110 + rand() * 40)}" fill="${a}"/>`;
      for (let i = 0; i < 9; i++) shapes += `<circle cx="${(rand() * 400).toFixed(0)}" cy="${(rand() * 500).toFixed(0)}" r="${(3 + rand() * 12).toFixed(1)}" fill="${a}"/>`;
      shapes += `<path d="${splatPath(rand, 260 + rand() * 80, 330 + rand() * 80, 60 + rand() * 30)}" fill="${b}" style="mix-blend-mode:multiply"/>`;
    } else if (style === "stripes") {
      for (let i = 0; i < 9; i++) shapes += `<rect x="${-40 + i * 52}" y="-40" width="26" height="600" fill="${i % 3 ? a : b}" transform="rotate(${12 + rand() * 6} 200 250)"/>`;
    } else if (style === "rings") {
      for (let i = 9; i > 0; i--) shapes += `<circle cx="200" cy="230" r="${i * 24}" fill="${i % 2 ? a : bg}"/>`;
      shapes += `<path d="${splatPath(rand, 200, 230, 46)}" fill="${b}"/>`;
    } else if (style === "drips") {
      shapes += `<rect x="0" y="0" width="400" height="150" fill="${a}"/>`;
      for (let i = 0; i < 10; i++) {
        const x = 12 + i * 40 + rand() * 10, h = 150 + rand() * 260, w = 12 + rand() * 16;
        shapes += `<rect x="${x}" y="100" width="${w}" height="${h}" rx="${w / 2}" fill="${a}"/>`;
      }
      shapes += `<circle cx="${100 + rand() * 200}" cy="420" r="30" fill="${b}"/>`;
    }
    return `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">
      <defs><pattern id="${id}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(${(rand() * 45).toFixed(0)})"><circle cx="4.5" cy="4.5" r="1.6" fill="${b}" opacity=".55"/></pattern></defs>
      <rect width="400" height="500" fill="${bg}"/>
      <rect width="400" height="500" fill="url(#${id})" opacity=".5"/>
      ${shapes}
      <text x="22" y="476" font-family="Archivo, Arial, sans-serif" font-weight="900" font-size="210" letter-spacing="-12" fill="${C.ink}" style="mix-blend-mode:multiply">${glyph}</text>
      <text x="22" y="34" font-family="Archivo, Arial, sans-serif" font-stretch="80%" font-weight="600" font-size="13" letter-spacing="1" fill="${C.ink}">${label.toUpperCase()}</text>
    </svg>`;
  }

  /* ======================================================== archive wheel
     1:1 drag (the front panel stays under your finger), flick projection,
     snap to the nearest piece, velocity handed to the spring. Grab it mid-spin to stop it. */
  // Placeholder covers until the studio's archive images arrive.
  const ARCHIVE = [
    ["Blot poster 01", C.paper, C.wet, C.ink, "B1", "splat"],
    ["Riso tests", C.pink, C.blue, C.ink, "R", "stripes"],
    ["Stamp set", C.yellow, C.wet, C.ink, "St", "rings"],
    ["Night signage", C.ink, C.yellow, C.wet, "Ns", "drips"],
    ["Ex libris", C.paper, C.green, C.blue, "Ex", "splat"],
    ["Menu cards", C.blue, C.paper, C.wet, "Mc", "stripes"],
    ["Blot poster 02", C.wet, C.ink, C.paper, "B2", "splat"],
    ["Tote run", C.paper, C.ink, C.pink, "Tr", "rings"],
    ["Loop studies", C.ink, C.pink, C.blue, "Ls", "drips"],
    ["Sticker sheet", C.green, C.yellow, C.ink, "Ss", "splat"]
  ];
  const ring = $("#ring"), wheel = $("#wheel");
  const archiveName = $("#archiveName"), archiveIndex = $("#archiveIndex");
  ring.innerHTML = ARCHIVE.map(([label, bg, a, b, glyph, style], i) =>
    `<figure class="panel" data-i="${i}">${cover(100 + i, { bg, a, b, glyph, label, style })}<figcaption>${String(i + 1).padStart(2, "0")} ${label}</figcaption></figure>`).join("");
  const panels = $$(".panel", ring);
  const N = panels.length, STEP = 360 / N;
  let radius = 0;
  function layoutWheel() {
    radius = ring.offsetWidth / (2 * Math.tan(Math.PI / N)) * 1.18;
    panels.forEach((p, i) => p.style.transform = `rotateY(${i * STEP}deg) translateZ(${radius}px)`);
    renderWheel();
  }
  const rot = new Spring(0, { damping: 1, response: .4, precision: .02 });
  const degPerPx = () => 180 / (Math.PI * radius);
  const wh = { down: false, dragging: false, id: null, x0: 0, y0: 0, rot0: 0, front: -1 };
  const wtrack = velocityTracker();

  function renderWheel() {
    ring.style.transform = `translateZ(${-radius}px) rotateX(-7deg) rotateY(${rot.value}deg)`;
    const front = ((Math.round(-rot.value / STEP) % N) + N) % N;
    if (front !== wh.front) {
      wh.front = front;
      archiveName.textContent = ARCHIVE[front][0];
      archiveIndex.textContent = String(front + 1).padStart(2, "0");
      panels.forEach((p, i) => {
        const d = Math.min(Math.abs(i - front), N - Math.abs(i - front));
        p.style.filter = `brightness(${1 - d * .14})`;
      });
    }
  }
  function wheelTask(dt) {
    if (!wh.dragging) rot.step(dt);
    renderWheel();
    return wh.dragging || !rot.resting;
  }
  const snap = deg => Math.round(deg / STEP) * STEP;
  function goTo(target, velocity) {
    rot.to(target, velocity == null ? { damping: 1, response: .4 } : { velocity, damping: .8, response: .5 });
    animate(wheelTask);
  }
  layoutWheel();
  addEventListener("resize", layoutWheel);

  wheel.addEventListener("pointerdown", e => {
    Object.assign(wh, { down: true, dragging: false, id: e.pointerId, x0: e.clientX, y0: e.clientY, rot0: rot.value });
    rot.target = rot.value; rot.velocity = 0;        // grab stops it exactly where it is
    wtrack.reset(); wtrack.add(e.clientX, 0);
  });
  wheel.addEventListener("pointermove", e => {
    if (!wh.down || e.pointerId !== wh.id) return;
    const dx = e.clientX - wh.x0, dy = e.clientY - wh.y0;
    if (!wh.dragging) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) { wh.down = false; return; }   // vertical intent: let the page scroll
      wh.dragging = true; wheel.classList.add("is-dragging");
      wheel.setPointerCapture(e.pointerId);
      wh.x0 = e.clientX; wh.rot0 = rot.value;        // start tracking from here, no jump
    }
    wtrack.add(e.clientX, 0);
    rot.jump(wh.rot0 + (e.clientX - wh.x0) * degPerPx());
    animate(wheelTask);
  });
  function endWheel(e) {
    if (!wh.down || e.pointerId !== wh.id) return;
    wh.down = false;
    if (wh.dragging) {
      wh.dragging = false; wheel.classList.remove("is-dragging");
      const v = wtrack.get().x * degPerPx();         // deg/s
      goTo(snap(rot.value + project(v)), v);         // land where the flick is going
    } else {
      // a tap on a side panel brings it to the front, the shortest way round
      const panel = e.target.closest(".panel");
      if (panel) {
        const i = +panel.dataset.i;
        let t = -i * STEP;
        t += Math.round((rot.value - t) / 360) * 360;
        goTo(t);
      } else goTo(snap(rot.value));
    }
  }
  wheel.addEventListener("pointerup", endWheel);
  wheel.addEventListener("pointercancel", endWheel);

  // Trackpad side-swipes turn it too, then settle on a piece.
  let wheelIdle;
  wheel.addEventListener("wheel", e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    rot.jump(rot.value - e.deltaX * degPerPx());
    animate(wheelTask);
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => goTo(snap(rot.value)), 120);
  }, { passive: false });

  // Buttons and keys step from the current target, so repeated presses stack without waiting.
  const stepBy = n => goTo(snap(rot.target) - n * STEP);
  $("#prev").addEventListener("click", () => stepBy(-1));
  $("#next").addEventListener("click", () => stepBy(1));
  wheel.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { e.preventDefault(); stepBy(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); stepBy(1); }
  });

  /* ======================================================== services
     Ink floods in from the point you enter and drains out the way you leave. */
  $$(".cell").forEach(c => {
    const at = e => {
      const r = c.getBoundingClientRect();
      c.style.setProperty("--x", `${e.clientX - r.left}px`);
      c.style.setProperty("--y", `${e.clientY - r.top}px`);
    };
    c.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") { at(e); c.classList.add("is-wet"); } });
    c.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") { at(e); c.classList.remove("is-wet"); } });
    c.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") { at(e); c.classList.toggle("is-wet"); } });
  });

  /* ======================================================== contact */
  const mail = $("#mail"), mailState = $("#mailState");
  let mailTimer;
  mail.addEventListener("click", () => {
    const done = (msg, ok) => {
      mailState.textContent = msg; mailState.classList.toggle("is-done", ok);
      clearTimeout(mailTimer);
      mailTimer = setTimeout(() => { mailState.textContent = "Tap to copy"; mailState.classList.remove("is-done"); }, 2400);
    };
    const fallback = () => {
      const sel = getSelection(), range = document.createRange();
      range.selectNodeContents(mail); sel.removeAllRanges(); sel.addRange(range);
      done("Selected. Press Ctrl+C to copy", false);
    };
    try { navigator.clipboard.writeText(mail.textContent.trim()).then(() => done("Copied to clipboard", true), fallback); }
    catch (_) { fallback(); }
  });

  /* ======================================================== footer
     Letters lean up toward the pointer, each on its own spring. */
  const foot = $("#foot");
  const letters = $$("#footWord span:not(.sp)");
  const lift = letters.map(() => new Spring(0, { damping: 1, response: .35, precision: .05 }));
  function footTask(dt) {
    lift.forEach((s, i) => {
      s.step(dt);
      letters[i].style.transform = `translate3d(0, ${-s.value}px, 0) scaleY(${1 + s.value / 600})`;
    });
    return lift.some(s => !s.resting);
  }
  foot.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    letters.forEach((l, i) => {
      const r = l.getBoundingClientRect();
      const f = Math.max(0, 1 - Math.abs(e.clientX - (r.left + r.width / 2)) / (r.width * 1.6));
      lift[i].to(f * r.height * .14);
    });
    animate(footTask);
  });
  foot.addEventListener("pointerleave", () => { lift.forEach(s => s.to(0)); animate(footTask); });

  /* ======================================================== navigation
     A pill slides between items on a critically damped spring; it moves on press,
     not after the scroll lands. The capsule darkens over ink-black chapters. */
  const bar = $("#bar");
  const nav = $("#nav");
  const navLinks = $$("a", nav);
  const navPill = $("#navPill");
  const sections = navLinks.map(a => $(a.getAttribute("href")));
  const darkZones = [$(".story"), $(".archive")];
  const pillX = new Spring(0, { damping: 1, response: .35, precision: .1 });
  const pillW = new Spring(0, { damping: 1, response: .35, precision: .1 });
  let active = -1, navLock = -1, navLockTimer;

  function pillTask(dt) {
    pillX.step(dt); pillW.step(dt);
    navPill.style.transform = `translate3d(${pillX.value}px, 0, 0)`;
    navPill.style.width = `${pillW.value}px`;
    navPill.style.opacity = pillW.value > 1 ? 1 : 0;
    return !(pillX.resting && pillW.resting);
  }
  function setActive(i, instant) {
    if (i === active) return;
    active = i;
    navLinks.forEach((a, j) => { a.classList.toggle("is-active", j === i); a.toggleAttribute("aria-current", j === i); });
    const l = navLinks[i];
    if (!l) { pillW.to(0); animate(pillTask); return; }
    if (instant || pillW.value < 1) { pillX.jump(l.offsetLeft); pillW.jump(l.offsetWidth); }
    else { pillX.to(l.offsetLeft); pillW.to(l.offsetWidth); }
    animate(pillTask);
  }
  navLinks.forEach((a, i) => {
    a.addEventListener("pointerdown", () => setActive(i));   // feedback on press
    a.addEventListener("click", e => {
      e.preventDefault();
      setActive(i);
      navLock = i; clearTimeout(navLockTimer);
      navLockTimer = setTimeout(() => { navLock = -1; onScroll(); }, 1200);
      sections[i].scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    });
  });
  $(".logo").addEventListener("click", e => { e.preventDefault(); scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }); });
  $$('.foot a[href="#top"]').forEach(a => a.addEventListener("click", e => { e.preventDefault(); scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }); }));
  addEventListener("scrollend", () => { if (navLock !== -1) { navLock = -1; onScroll(); } });

  /* ======================================================== scroll */
  let ticking = false;
  function onScroll() {
    updateStory();
    // nav state
    if (navLock === -1) {
      let a = -1;
      sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top < innerHeight * .4) a = i; });
      setActive(Math.max(0, a));
    }
    // capsule tone
    const y = bar.getBoundingClientRect().bottom - 20;
    const dark = darkZones.some(z => { const r = z.getBoundingClientRect(); return r.top <= y && r.bottom >= y; });
    bar.dataset.tone = dark ? "dark" : "light";
    // scroll velocity feeds the ticker
    const now = performance.now(), dt = Math.max(16, now - lastScrollT) / 1000;
    tickVel.to(clamp((scrollY - lastScrollY) / dt, -3000, 3000));
    lastScrollY = scrollY; lastScrollT = now;
    clearTimeout(onScroll.settle);
    onScroll.settle = setTimeout(() => tickVel.to(0), 90);
    ticking = false;
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener("resize", () => { const i = active; active = -1; setActive(i, true); onScroll(); });
  document.fonts && document.fonts.ready.then(() => { const i = active; active = -1; setActive(i, true); layoutWheel(); });
  onScroll();
})();
