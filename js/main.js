/* Wet Ink Studio: interactions
   Luxury tech on engraved paper: an iridescent form, chrome sparkles, guilloche, and ink that is still wet.
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
      this.k = Math.pow(2 * Math.PI / response, 2);
      this.c = 4 * Math.PI * damping / response;
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
      const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = -this.k * (this.value - this.target) - this.c * this.velocity;
        this.velocity += a * h;
        this.value += this.velocity * h;
      }
      if (this.resting) this.jump(this.target);
    }
    get resting() { return Math.abs(this.velocity) < this.precision && Math.abs(this.value - this.target) < this.precision; }
  }

  /* One display-synced clock for everything that moves. A task returns true while it needs frames. */
  const tasks = new Set();
  let clockOn = false, lastFrame = 0;
  function animate(task) {
    tasks.add(task);
    if (!clockOn) { clockOn = true; lastFrame = performance.now(); requestAnimationFrame(frame); }
  }
  function frame(now) {
    const dt = Math.min(1 / 20, (now - lastFrame) / 1000); lastFrame = now;
    for (const t of tasks) if (!t(dt)) tasks.delete(t);
    if (tasks.size) requestAnimationFrame(frame); else clockOn = false;
  }

  /* Velocity from the last ~80 ms of pointer history. */
  function velocityTracker() {
    const h = [];
    return {
      reset() { h.length = 0; },
      add(x, y, t = performance.now()) { h.push({ x, y, t }); while (h.length > 2 && t - h[0].t > 80) h.shift(); },
      get() {
        if (h.length < 2) return { x: 0, y: 0 };
        const a = h[0], b = h[h.length - 1];
        if (performance.now() - b.t > 60) return { x: 0, y: 0 };   // stopped before lifting
        const dt = Math.max(.008, (b.t - a.t) / 1000);
        return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
      }
    };
  }

  /* Apple's momentum projection (exponential decay, like scroll deceleration). */
  const project = (v, rate = .998) => (v / 1000) * rate / (1 - rate);
  /* Progressive resistance past a boundary. */
  const rubberband = (over, dim, c = .55) => (over * dim * c) / (dim + c * Math.abs(over));

  /* A reusable 1:1 horizontal drag with hysteresis, velocity and vertical-scroll handoff. */
  function hDrag(el, { start, move, end, tap }) {
    let s = null;
    const tr = velocityTracker();
    el.addEventListener("pointerdown", e => {
      if (e.button) return;
      s = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
      tr.reset(); tr.add(e.clientX, 0);
      start && start(e);
    });
    el.addEventListener("pointermove", e => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.on) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) { s = null; return; }   // vertical intent: the page scrolls
        s.on = true; s.x = e.clientX; el.setPointerCapture(e.pointerId);
      }
      tr.add(e.clientX, 0);
      move(e.clientX - s.x, e);
    });
    const up = e => {
      if (!s || e.pointerId !== s.id) return;
      const was = s.on; s = null;
      if (was) end(tr.get().x, e); else tap && tap(e);
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return { get dragging() { return !!(s && s.on); } };
  }

  /* Seeded random so every generated piece renders the same way on every visit */
  const rng = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ============================================================ ink layer
     WebGL metaballs over the whole page, in two inks (black, Riso orange).
     Pass 1 adds soft gaussian sprites into a half-resolution field (R = black, G = orange).
     Pass 2 runs at full device resolution and thresholds the bilinearly filtered field with
     smoothstep, so edges are smooth curves instead of pixels. The field's slope gives a wet sheen. */
  const ink = (() => {
    const cv = document.createElement("canvas");
    cv.className = "ink-layer"; cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
    const parts = [];
    if (!gl) return { spawn() {}, count: () => 0 };

    const FIELD = .5, dpr = Math.min(2, devicePixelRatio || 1);
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p); return p;
    };
    const sprite = prog(`
      attribute vec2 a_pos; attribute vec2 a_uv; attribute vec2 a_amt;
      uniform vec2 u_view; varying vec2 v_uv; varying vec2 v_amt;
      void main() { vec2 c = a_pos / u_view * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); v_uv = a_uv; v_amt = a_amt; }`, `
      precision mediump float; varying vec2 v_uv; varying vec2 v_amt;
      void main() { float d2 = dot(v_uv, v_uv); float a = exp(-4.0 * d2) * step(d2, 1.0); gl_FragColor = vec4(v_amt * a, 0.0, 0.0); }`);
    const comp = prog(`
      attribute vec2 a_pos; varying vec2 v_uv;
      void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`, `
      precision highp float;
      uniform sampler2D u_f; uniform vec2 u_px; varying vec2 v_uv;
      const float T = 0.36; const float W = 0.022;
      const vec3 BLACK = vec3(0.776, 1.0, 0.102);  const vec3 BLACK_RIM = vec3(0.45, 0.62, 0.0);   /* fluo green */
      const vec3 ORANGE = vec3(1.0, 0.243, 0.784); const vec3 ORANGE_RIM = vec3(0.68, 0.06, 0.5);  /* fluo pink */
      float sum(vec2 uv) { vec2 f = texture2D(u_f, uv).rg; return f.r + f.g; }
      void main() {
        vec2 f = texture2D(u_f, v_uv).rg;
        float kb = smoothstep(T - W, T + W, f.r);
        float ko = smoothstep(T - W, T + W, f.g);
        float a = kb + ko * (1.0 - kb);
        if (a < 0.002) { gl_FragColor = vec4(0.0); return; }
        vec3 cb = mix(BLACK_RIM, BLACK, smoothstep(T, T + 0.2, f.r));
        vec3 co = mix(ORANGE_RIM, ORANGE, smoothstep(T, T + 0.2, f.g));
        vec3 col = (cb * kb + co * ko * (1.0 - kb)) / a;
        float sx = sum(v_uv + vec2(u_px.x, 0.0)) - sum(v_uv - vec2(u_px.x, 0.0));
        float sy = sum(v_uv + vec2(0.0, u_px.y)) - sum(v_uv - vec2(0.0, u_px.y));
        vec3 n = normalize(vec3(-sx * 5.0, -sy * 5.0, 1.0));
        vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
        float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 30.0);
        float core = smoothstep(T + 0.04, T + 0.3, f.r + f.g);
        col += spec * 0.5 * core;
        gl_FragColor = vec4(col * a, a);
      }`);

    // field target: half-float if the device supports rendering and filtering it, else bytes
    const hf = gl.getExtension("OES_texture_half_float");
    const hfl = gl.getExtension("OES_texture_half_float_linear");
    gl.getExtension("EXT_color_buffer_half_float");
    const tex = gl.createTexture(), fbo = gl.createFramebuffer();
    let texType = hf && hfl ? hf.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
    let FW = 1, FH = 1, VW = 1, VH = 1;
    function alloc() {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FW, FH, 0, gl.RGBA, texType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (texType !== gl.UNSIGNED_BYTE && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { texType = gl.UNSIGNED_BYTE; alloc(); }
    }
    function size() {
      VW = innerWidth; VH = innerHeight;
      cv.width = Math.round(VW * dpr); cv.height = Math.round(VH * dpr);
      FW = Math.max(1, Math.ceil(VW * FIELD)); FH = Math.max(1, Math.ceil(VH * FIELD));
      alloc();
    }
    size();
    addEventListener("resize", () => { size(); if (parts.length) animate(task); });

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const vbuf = gl.createBuffer();
    const MAX = 520;
    const verts = new Float32Array(MAX * 6 * 6);
    const loc = {
      pos: gl.getAttribLocation(sprite, "a_pos"), uv: gl.getAttribLocation(sprite, "a_uv"), amt: gl.getAttribLocation(sprite, "a_amt"),
      view: gl.getUniformLocation(sprite, "u_view"),
      cpos: gl.getAttribLocation(comp, "a_pos"), f: gl.getUniformLocation(comp, "u_f"), px: gl.getUniformLocation(comp, "u_px")
    };
    const CORNERS = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];

    function spawn(p) {
      if (parts.length >= MAX) parts.splice(0, parts.length - MAX + 1);
      parts.push(Object.assign({ vx: 0, vy: 0, age: 0, grow: 1.2, life: 2.6, drip: false, c: 0 }, p));
      animate(task);
    }

    let running = false;
    function task(dt) {
      if (document.body.classList.contains("sheet-covered")) return parts.length > 0;   // hidden under a sheet: skip the work
      // simulate (page coordinates)
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;                       // paper soaks the ink up
        p.vx *= Math.pow(.02, dt); p.vy *= p.drip ? Math.pow(.55, dt) : Math.pow(.02, dt);
        if (p.drip && p.vy > 8 && Math.random() < .6 && parts.length < MAX - 4) {
          parts.push({ x: p.x + (Math.random() - .5) * 2, y: p.y, r: p.r * .8, tr: p.tr * (.75 + Math.random() * .2), life: 4 + Math.random() * 2, vx: 0, vy: 0, age: 0, grow: 1.2, c: p.c });
        }
      }
      // pass 1: field
      const sx = scrollX, sy = scrollY;
      let n = 0;
      for (const p of parts) {
        const k = p.age / p.life;
        const grown = lerp(p.r, p.tr * p.grow, 1 - Math.pow(1 - Math.min(1, p.age * 2.2), 3));
        const rad = grown * (k > .65 ? 1 - (k - .65) / .35 : 1);  // evaporate in the last third
        if (rad <= .5) continue;
        const S = rad * 2, x = p.x - sx, y = p.y - sy;
        if (x < -S || x > VW + S || y < -S || y > VH + S) continue;
        const ab = p.c ? 0 : 1, ao = p.c ? 1 : 0;
        for (const [u, v] of CORNERS) {
          const o = n * 6; verts[o] = x + u * S; verts[o + 1] = y + v * S; verts[o + 2] = u; verts[o + 3] = v; verts[o + 4] = ab; verts[o + 5] = ao; n++;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, FW, FH);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (n) {
        gl.useProgram(sprite);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
        gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, n * 6), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 24, 8);
        gl.enableVertexAttribArray(loc.amt); gl.vertexAttribPointer(loc.amt, 2, gl.FLOAT, false, 24, 16);
        gl.uniform2f(loc.view, VW, VH);
        gl.drawArrays(gl.TRIANGLES, 0, n);
        gl.disableVertexAttribArray(loc.uv); gl.disableVertexAttribArray(loc.amt);
      }
      // pass 2: composite at device resolution
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.disable(gl.BLEND);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (n) {
        gl.useProgram(comp);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(loc.cpos); gl.vertexAttribPointer(loc.cpos, 2, gl.FLOAT, false, 8, 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc.f, 0); gl.uniform2f(loc.px, 1 / FW, 1 / FH);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      running = parts.length > 0;
      return running;
    }
    // ink lives in page space, so scrolling needs a redraw while any is on screen
    addEventListener("scroll", () => { if (parts.length) animate(task); }, { passive: true });
    return { spawn, count: () => parts.length };
  })();

  const GREEN = 0, PINK = 1;
  /* A drop inherits the stroke's velocity, so a moving press throws its splash forward. */
  function dropInk(x, y, size = 1, vx = 0, vy = 0, color = GREEN, accent = .3) {
    const R = (34 + Math.random() * 30) * size;
    ink.spawn({ x, y, r: R * .35, tr: R, life: 11, grow: 1, vx: vx * .15, vy: vy * .15, c: color });
    const n = 7 + (Math.random() * 7 | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = R * (0.6 + Math.random() * 0.9), sp = 140 + Math.random() * 260;
      ink.spawn({ x: x + Math.cos(a) * d * .3, y: y + Math.sin(a) * d * .3,
                  vx: Math.cos(a) * sp * size + vx * .45, vy: Math.sin(a) * sp * size + vy * .45,
                  r: 3, tr: (5 + Math.random() * 12) * size, life: 7 + Math.random() * 4, grow: 1,
                  c: Math.random() < accent ? 1 - color : color });
    }
    if (reduced) return;
    const runs = 1 + (Math.random() < .5 ? 1 : 0);   // one or two runs crawl down the page
    for (let i = 0; i < runs; i++) {
      ink.spawn({ x: x + (Math.random() - .5) * R, y: y + R * .4, vy: 60 + Math.random() * 60,
                  r: 8, tr: 9 * size, life: 6 + Math.random() * 3, drip: true, grow: 1, c: color });
    }
  }

  /* ============================================================ hero + trail */
  const hero = $("#stage");   // the hero stage: presses here drop ink
  const sheetOpen = () => !$("#sheet").hidden;
  const stroke = velocityTracker();
  let lastTrail = null, touchStart = null;

  // Continuous feedback: a fluorescent trail follows the pointer anywhere on the page (mouse and pen).
  addEventListener("pointermove", e => {
    if (e.pointerType === "touch" || reduced || sheetOpen() || mascotState.active) { lastTrail = null; return; }
    const trailInk = e.target.closest && e.target.closest(".contact") ? GREEN : PINK;
    const x = e.pageX, y = e.pageY;
    stroke.add(e.clientX, e.clientY);
    if (lastTrail) {
      const dx = x - lastTrail.x, dy = y - lastTrail.y, dist = Math.hypot(dx, dy);
      if (dist < 7) return;
      const speed = clamp(dist / 40, 0, 1);   // fast strokes lay thinner ink, like a dragged brush
      const n = Math.min(12, Math.ceil(dist / 8));   // fill the gap between events so the line stays continuous
      for (let i = 1; i <= n; i++) {
        ink.spawn({ x: lastTrail.x + dx * i / n, y: lastTrail.y + dy * i / n, r: 4, tr: lerp(16, 7, speed),
                    life: 1.9 + Math.random() * .6, vx: dx * .3, vy: dy * .3, c: trailInk });
      }
    }
    lastTrail = { x, y };
  }, { passive: true });
  document.addEventListener("pointerleave", () => { lastTrail = null; });

  // Respond on press. Touch waits for the tap to resolve so scrolling never splashes.
  hero.addEventListener("pointerdown", e => {
    if (e.target.closest("button, a")) return;
    if (e.pointerType === "touch") { touchStart = { x: e.pageX, y: e.pageY, t: performance.now() }; return; }
    const v = stroke.get();
    dropInk(e.pageX, e.pageY, .9, v.x, v.y, PINK, .3);
  });
  hero.addEventListener("pointerup", e => {
    if (e.pointerType !== "touch" || !touchStart) return;
    if (Math.hypot(e.pageX - touchStart.x, e.pageY - touchStart.y) < 10 && performance.now() - touchStart.t < 500) dropInk(e.pageX, e.pageY, .7, 0, 0, PINK, .2);
    touchStart = null;
  });
  hero.addEventListener("pointercancel", () => { touchStart = null; });

  /* ================================================================ Blot
     Grab it where you grabbed it, drag it 1:1 on a rubber-band leash, throw it.
     It springs home carrying your release velocity. */
  const mascot = $("#mascot");
  const pupils = $$(".pupil", mascot);
  const mx = new Spring(0, { damping: .55, response: .5, precision: .05 });
  const my = new Spring(reduced ? 0 : -260, { damping: .55, response: .5, precision: .05 });
  const msx = new Spring(1, { damping: .45, response: .3, precision: .001 });
  const msy = new Spring(1, { damping: .45, response: .3, precision: .001 });
  const px = new Spring(0, { damping: 1, response: .18, precision: .005 });
  const py = new Spring(0, { damping: 1, response: .18, precision: .005 });
  const mascotState = { active: false, dragging: false, id: null, start: null, origin: null };
  const mtrack = velocityTracker();

  function renderMascot() {
    mascot.style.transform = `translate3d(${mx.value}px, ${my.value}px, 0) scale(${msx.value}, ${msy.value})`;
    pupils.forEach(p => p.setAttribute("transform", `translate(${px.value.toFixed(2)} ${py.value.toFixed(2)})`));
  }
  const mascotSprings = [mx, my, msx, msy, px, py];
  function mascotTask(dt) {
    mascotSprings.forEach(s => { if (!(mascotState.dragging && (s === mx || s === my))) s.step(dt); });
    renderMascot();
    return mascotState.dragging || mascotSprings.some(s => !s.resting);
  }
  renderMascot();
  // Entrance: it falls into place as the dot of the ı. A fall carries momentum, so it may bounce.
  if (!reduced) setTimeout(() => { my.to(0, { velocity: 900 }); msy.to(1, { velocity: -3 }); animate(mascotTask); }, 450);

  addEventListener("pointermove", e => {
    if (mascotState.dragging || reduced) return;
    const b = mascot.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height * .62;
    const a = Math.atan2(e.clientY - cy, e.clientX - cx);
    const d = clamp(Math.hypot(e.clientX - cx, e.clientY - cy) / 80, 0, 1) * 2.6;
    px.to(Math.cos(a) * d); py.to(Math.sin(a) * d);
    animate(mascotTask);
  }, { passive: true });

  const mascotPage = () => { const b = mascot.getBoundingClientRect(); return { x: b.left + scrollX + b.width / 2, y: b.top + scrollY + b.height * .7, w: b.width }; };

  mascot.addEventListener("pointerdown", e => {
    e.preventDefault();
    mascot.setPointerCapture(e.pointerId);
    Object.assign(mascotState, { active: true, dragging: false, id: e.pointerId,
      start: { x: e.clientX, y: e.clientY }, origin: { x: mx.value, y: my.value } });   // from the presentation value
    mx.velocity = my.velocity = 0;
    mtrack.reset(); mtrack.add(e.clientX, e.clientY);
    msx.to(1.12, { response: .15, damping: .7 }); msy.to(.88, { response: .15, damping: .7 });   // instant press squish
    animate(mascotTask);
  });
  mascot.addEventListener("pointermove", e => {
    if (!mascotState.active || e.pointerId !== mascotState.id) return;
    const dx = e.clientX - mascotState.start.x, dy = e.clientY - mascotState.start.y;
    if (!mascotState.dragging && Math.hypot(dx, dy) > 10) mascotState.dragging = true;
    if (!mascotState.dragging) return;
    mtrack.add(e.clientX, e.clientY);
    let x = mascotState.origin.x + dx, y = mascotState.origin.y + dy;
    const leash = Math.min(hero.clientWidth * .35, 260), d = Math.hypot(x, y);
    if (d > leash) { const k = (leash + rubberband(d - leash, 320)) / d; x *= k; y *= k; }
    mx.jump(x); my.jump(y);
    const v = mtrack.get(), sp = Math.hypot(v.x, v.y) || 1, st = clamp(sp / 4000, 0, .3);   // speed reads as stretch
    msx.to(1 + st * Math.abs(v.x) / sp - st * .5 * Math.abs(v.y) / sp, { response: .12, damping: 1 });
    msy.to(1 + st * Math.abs(v.y) / sp - st * .5 * Math.abs(v.x) / sp, { response: .12, damping: 1 });
    px.to(clamp(v.x / 400, -2.6, 2.6)); py.to(clamp(v.y / 400, -2.6, 2.6));
    const m = mascotPage();
    if (!reduced) ink.spawn({ x: m.x, y: m.y - m.w * .1, r: 4, tr: 9 + m.w * .12, life: 2.4, c: PINK });
  });
  function releaseMascot(e) {
    if (!mascotState.active || e.pointerId !== mascotState.id) return;
    const wasDrag = mascotState.dragging;
    mascotState.active = mascotState.dragging = false;
    const m = mascotPage();
    if (wasDrag) {
      const v = mtrack.get(), speed = Math.hypot(v.x, v.y);
      if (speed > 900) {   // a real throw lands somewhere: splash where the momentum would carry it
        const h = hero.getBoundingClientRect();
        const lx = clamp(m.x + project(v.x, .99), h.left + scrollX + 20, h.right + scrollX - 20);
        const ly = clamp(m.y + project(v.y, .99), h.top + scrollY + 20, h.bottom + scrollY - 20);
        dropInk(lx, ly, .8, v.x, v.y, PINK, .25);
      }
      mx.to(0, { velocity: v.x, damping: .55, response: .5 });   // hand off the release velocity
      my.to(0, { velocity: v.y, damping: .55, response: .5 });
    } else {
      dropInk(m.x, m.y + 6, .6, 0, 0, PINK, .3);
    }
    msx.to(1, { velocity: wasDrag ? 0 : -4, damping: .4, response: .35 });
    msy.to(1, { velocity: wasDrag ? 0 : 5, damping: .4, response: .35 });
    animate(mascotTask);
  }
  mascot.addEventListener("pointerup", releaseMascot);
  mascot.addEventListener("pointercancel", releaseMascot);
  mascot.addEventListener("click", e => {   // keyboard activation gets the same tap response
    if (e.detail !== 0) return;
    const m = mascotPage();
    dropInk(m.x, m.y + 6, .6, 0, 0, PINK, .3);
    msy.to(1, { velocity: 5, damping: .4, response: .35 }); msx.to(1, { velocity: -4, damping: .4, response: .35 });
    animate(mascotTask);
  });

  /* ============================================================ pointer, shared
     One pointer record (client coords) and a spring-smoothed sheen position for every chrome surface. */
  const ptr = { x: innerWidth * .6, y: innerHeight * .45, has: false };
  const sheen = new Spring(50, { damping: 1, response: .6, precision: .05 });
  function sheenTask(dt) { sheen.step(dt); root.style.setProperty("--sheen", sheen.value.toFixed(2) + "%"); return !sheen.resting; }
  addEventListener("pointermove", e => {
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.has = true;
    if (!reduced) { sheen.to(100 - (e.clientX / innerWidth) * 100); animate(sheenTask); }
  }, { passive: true });

  /* ============================================================ guilloche engraving
     Banknote-style rosettes and bands, generated as hairline SVG paths (19th-century security engraving). */
  const SVGNS = "http://www.w3.org/2000/svg";
  function rosette(svg) {
    const rings = [
      { R: 430, A: 34, k: 30, n: 16, m: 3 },
      { R: 318, A: 30, k: 22, n: 14, m: 2 },
      { R: 205, A: 26, k: 14, n: 12, m: 3 },
      { R: 96, A: 20, k: 8, n: 10, m: 2 }
    ];
    rings.forEach((g, gi) => {
      const grp = document.createElementNS(SVGNS, "g");
      grp.setAttribute("class", "ring ring--" + (gi % 2 ? "ccw" : "cw"));
      let d = "";
      for (let j = 0; j < g.n; j++) {
        const ph = j * Math.PI * 2 / (g.n * g.k);
        for (let s = 0; s <= 360; s++) {
          const t = s / 360 * Math.PI * 2;
          const r = g.R + g.A * Math.sin(g.k * t + ph * g.k) + g.A * .35 * Math.sin((g.k * g.m + 1) * t - ph * g.k * 2);
          d += (s ? "L" : "M") + (r * Math.cos(t)).toFixed(1) + " " + (r * Math.sin(t)).toFixed(1);
        }
      }
      const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); grp.appendChild(p); svg.appendChild(grp);
    });
  }
  function band(svg) {
    const W = 1440, H = 100;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
    let d = "";
    for (let j = 0; j < 18; j++) {
      const ph = j * Math.PI / 18;
      for (let s = 0; s <= 360; s++) {
        const x = s / 360 * W;
        const y = H / 2 + 34 * Math.sin(x / W * Math.PI * 16 + ph) * Math.cos(x / W * Math.PI * 3 + ph * .5) + 8 * Math.sin(x / W * Math.PI * 70 - ph * 2);
        d += (s ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
    }
    const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); svg.appendChild(p);
  }
  rosette($("#rosette"));
  $$("[data-gband]").forEach(band);
  // the rings turn against each other, very slowly, only while the hero is on screen
  const ringEls = $$("#rosette .ring");
  let rosetteAngle = 0, heroOn = true;
  function rosetteTask(dt) {
    if (!heroOn || reduced) return false;
    rosetteAngle += dt * 1.5;   // degrees per second
    ringEls.forEach((g, i) => g.setAttribute("transform", `rotate(${(i % 2 ? -1 : 1) * rosetteAngle * (1 + i * .25)})`));
    return true;
  }

  // hero: the engraving turns only while the hero is on screen
  new IntersectionObserver(([en]) => { heroOn = en.isIntersecting; if (heroOn) animate(rosetteTask); }).observe(hero);

  // shared with the 3D layer (js/scene3d.js): the pointer and Blot's springs
  window.__wi = { ptr, msx, msy, px, py };

  /* ============================================================ section reveals
     In view once (15%), rise 28px over .8s, siblings staggered by .1s. */
  const revealIO = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    en.target.classList.add("is-in"); revealIO.unobserve(en.target);
  }), { threshold: .15 });
  $$(".reveal").forEach(el => {
    const sibs = [...el.parentElement.children].filter(c => c.classList.contains("reveal"));
    el.style.setProperty("--i", Math.min(sibs.indexOf(el), 4));
    revealIO.observe(el);
  });

  /* ============================================================ archive pieces
     Interactive pieces shown inside the detail sheet. */
  const IMG = "assets/archive/";
  const browser = (url, inner) => `<div class="browser"><div class="browser__bar"><i></i><i></i><i></i><span>${url}</span></div>${inner}</div>`;

  const SITES = {
    /* Quiet Luxury / Loud Feet: grab a sock on the line and set it swinging.
       Each sock is a pendulum on its own spring, pivoting at its peg. */
    socks: {
      frame: false,
      html: () => `<div class="socks"><div class="socks__scene" style="background-image:url(${IMG}socks-scene.webp)">
        <img class="sock" data-sock="L" src="${IMG}sock-left.webp" alt="" draggable="false" style="left:18.247%;top:2.791%;width:25.567%;transform-origin:49.60% 8.02%">
        <img class="sock" data-sock="R" src="${IMG}sock-right.webp" alt="" draggable="false" style="left:50.103%;top:3.349%;width:22.577%;transform-origin:57.99% 7.80%">
      </div></div>`,
      bind(el) {
        const MAX = 28;   // degrees before the line starts to resist
        const soft = a => Math.abs(a) <= MAX ? a : Math.sign(a) * (MAX + rubberband(Math.abs(a) - MAX, MAX));
        $$(".sock", el).forEach(sock => {
          const ang = new Spring(0, { damping: .8, response: .55, precision: .02 });   // it was thrown: a little swing is right
          const tr = velocityTracker();
          let drag = null;
          const draw = dt => { if (!drag) ang.step(dt); sock.style.transform = `rotate(${ang.value}deg)`; return !!drag || !ang.resting; };
          const pivot = () => {
            const r = sock.parentElement.getBoundingClientRect(), [ox, oy] = getComputedStyle(sock).transformOrigin.split(" ").map(parseFloat);
            return { x: r.left + sock.offsetLeft + ox, y: r.top + sock.offsetTop + oy };
          };
          const pointerAngle = (e, p) => -Math.atan2(e.clientX - p.x, e.clientY - p.y) * 180 / Math.PI;
          sock.tabIndex = 0;
          sock.setAttribute("role", "button");
          sock.setAttribute("aria-label", sock.dataset.sock === "L" ? "Left sock, Quiet Luxury. Press Enter to swing it." : "Right sock, Loud Feet. Press Enter to swing it.");
          sock.addEventListener("pointerdown", e => {
            sock.setPointerCapture(e.pointerId); sock.classList.add("is-grabbed");
            ang.jump(ang.value);                       // catch it mid-swing, exactly where it is
            const p = pivot();
            drag = { p, a0: ang.value, g0: pointerAngle(e, p) };
            tr.reset(); tr.add(ang.value, 0);
            animate(draw);
          });
          sock.addEventListener("pointermove", e => {
            if (!drag) return;
            ang.jump(soft(drag.a0 + pointerAngle(e, drag.p) - drag.g0));
            tr.add(ang.value, 0);
          });
          const up = () => {
            if (!drag) return;
            drag = null; sock.classList.remove("is-grabbed");
            ang.to(0, { velocity: tr.get().x });       // let go with the swing you gave it
            animate(draw);
          };
          sock.addEventListener("pointerup", up);
          sock.addEventListener("pointercancel", up);
          sock.addEventListener("keydown", e => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            ang.to(0, { velocity: ang.velocity + (sock.dataset.sock === "L" ? -160 : 160) });
            animate(draw);
          });
        });
      }
    },
  };

  /* ============================================================ archive data */
  const ARCHIVE = [
    { kind: "Website", client: true, title: "Escu & Co.", url: "escufin.com", tags: ["Finance", "Website", "EN / FR"],
      images: [
        { src: IMG + "escufin-1.webp", alt: "Escu & Co. homepage: a serif headline, 'The opportunities that reshape markets are rarely obvious.', over a dark navy background with a dotted horizon." },
        { src: IMG + "escufin-2.webp", alt: "Track record section: a large '15+', 'Years connecting international businesses across industries and markets', and a line-drawn classical column." },
        { src: IMG + "escufin-3.webp", alt: "What we do section on a paper-toned background: Identify, Structure, Build, each with a fine line icon and a short description." }
      ],
      text: "Website for Escu &amp; Co., a European consultancy and financial management firm. Dark navy and quiet: a serif headline over a dotted horizon, a line-drawn column for the track record, and a paper-toned section for what they do. In English and French.",
      link: "https://www.escufin.com/" },
    { kind: "Product", client: true, site: "socks", title: "Quiet Luxury / Loud Feet", tags: ["Product", "Illustration", "Interactive"],
      images: [{ src: IMG + "loud-feet-sock.webp", alt: "A cream Loud Feet sock on a wooden peg, with red lettering and a blue smiling pearl in an oyster." }],
      text: "A pair of cream socks. The left one reads Quiet Luxury with a smiling champagne coupe; the right one reads Loud Feet with a smiling pearl in an oyster.",
      tryIt: "Grab a sock on the line and set it swinging." },
    { kind: "Packaging", client: true, title: "Colour Pencil Boxes", tags: ["Packaging", "Illustration", "Print"],
      bg: "#E9DCC6", fit: "contain",
      images: [{ src: IMG + "crayons.webp", alt: "Four colour-pencil boxes on a wooden table, each sleeve with one flat illustration: a red tulip on yellow, a crescent moon over green hills, a bluebird on pink, and two orange quilt stars on green." }],
      text: "A set of four pencil sleeves. Each carries one flat illustration (a tulip, a night sky, a bluebird and quilt stars) and its own patterned spine, so the boxes read as a family on a shelf." },
    { kind: "Packaging", client: true, title: "Jus d'Art", tags: ["Packaging", "Label", "Identity"],
      bg: "#B6B5FF", fit: "contain",
      images: [{ src: IMG + "jus-dart-carton.webp", alt: "Tall Jus d'Art juice carton with a bent blue straw on a lavender background. The top flap reads Art Juice, with Jus d'Art printed upside down beneath it; below, a red line-drawn apple and 'Jus de pomme, pressé à froid, sans sucre ajouté'." },
               { src: IMG + "jus-dart-label.webp", alt: "Flat Jus d'Art label: Art Juice and an upside-down Jus d'Art at the top, a red outline apple with coloured dots, a 'pomme + rien' badge, a 'restez curieux' tag, 'Jus de pomme, pressé à froid, sans sucre ajouté' and 200 mL." }],
      text: "Carton and label for Art Juice's cold-pressed apple juice. The top flap carries the name twice, once upside down; below, one red line-drawn apple, a \u201cpomme + rien\u201d badge and the line \u201crestez curieux\u201d." },
    { kind: "Postcard", client: true, title: "Printing Studio Postcard", tags: ["Die-cut", "Illustration", "Print"],
      bg: "#5367D1", fit: "contain",
      images: [{ src: IMG + "postcard.webp", alt: "Die-cut postcard shaped like a printing-studio shopfront: green front with a striped awning, pink back reading 'print with us and be remembered'." }],
      text: "A die-cut postcard cut to the outline of the shop. The front is the shopfront; the back says “print with us and be remembered” and leaves room for a stamp." }
  ];

  const siteMarkup = it => SITES[it.site].frame === false ? SITES[it.site].html() : browser(SITES[it.site].url, SITES[it.site].html());
  /* ============================================================ archive: an abstract field
     Fragments of the real work, cut into sharp shapes, blurred and washed in iridescence, drifting at
     different depths. Nothing is labelled until you come close: each fragment's focus is a spring driven by
     the pointer's distance. Click a fragment to open the piece. Touch: first tap focuses, second opens. */
  const FRAGS = [
    { i: 0, src: IMG + "escufin-1.webp", shape: "rect",    x: .50, y: .10, w: .30, ar: 1.6,  z: .6 },
    { i: 2, src: IMG + "crayons.webp",   shape: "star",    x: .16, y: .14, w: .24, ar: 1,    z: .9 },
    { i: 0, src: IMG + "escufin-2.webp", shape: "sliver",  x: .06, y: .56, w: .17, ar: .72,  z: .35 },
    { i: 3, src: IMG + "jus-dart-carton.webp", shape: "rect", x: .36, y: .52, w: .13, ar: .56, z: .5 },
    { i: 1, src: IMG + "loud-feet-sock.webp",  shape: "arch", x: .75, y: .44, w: .11, ar: .42, z: .85 },
    { i: 4, src: IMG + "postcard.webp",  shape: "diamond", x: .54, y: .64, w: .2,  ar: 1,    z: .7 },
    { i: 3, src: IMG + "jus-dart-label.webp",  shape: "sliver", x: .88, y: .08, w: .09, ar: .38, z: .25 },
    { i: 0, src: IMG + "escufin-3.webp", shape: "star",    x: .86, y: .74, w: .12, ar: 1,    z: .45 },
    { i: 2, src: IMG + "crayons.webp",   shape: "diamond", x: .24, y: .80, w: .1,  ar: 1,    z: .3 }
  ];
  const field = $("#field");
  field.innerHTML = FRAGS.map((f, n) => `<button class="frag frag--${f.shape}" type="button" role="listitem" data-n="${n}" aria-label="${ARCHIVE[f.i].title}">
      <span class="frag__cut"><img src="${f.src}" alt="" draggable="false" loading="lazy"></span>
      <span class="frag__name" aria-hidden="true">${ARCHIVE[f.i].title}</span></button>`).join("");
  const fragEls = $$(".frag", field);
  const focusS = FRAGS.map(() => new Spring(0, { damping: 1, response: .45, precision: .003 }));
  const par = { x: new Spring(0, { damping: 1, response: 1, precision: .05 }), y: new Spring(0, { damping: 1, response: 1, precision: .05 }) };
  let FW = 0, FH = 0, fieldOn = false, fieldT = 0, tapped = -1, kbd = -1;
  function layoutField() {
    FW = field.clientWidth; FH = field.clientHeight;
    const narrow = FW < 720;
    fragEls.forEach((el, n) => {
      const f = FRAGS[n], w = Math.min(FW * f.w * (narrow ? 1.9 : 1), narrow ? FW * .6 : 520);
      el.style.width = w + "px"; el.style.height = w / f.ar + "px";
      f.px = clamp(f.x * FW, 0, FW - w); f.py = clamp(f.y * FH, 0, FH - w / f.ar - 30); f.pw = w; f.ph = w / f.ar;
    });
  }
  function fieldTask(dt) {
    if (!fieldOn) return false;
    if (!reduced) fieldT += dt;
    const r = field.getBoundingClientRect();
    if (ptr.has && !reduced) { par.x.to((ptr.x - r.left - FW / 2) / FW); par.y.to((ptr.y - r.top - FH / 2) / FH); }
    par.x.step(dt); par.y.step(dt);
    fragEls.forEach((el, n) => {
      const f = FRAGS[n];
      const ox = Math.sin(fieldT * (.25 + f.z * .2) + n * 1.7) * 14 * f.z - par.x.value * 60 * f.z;
      const oy = Math.cos(fieldT * (.2 + f.z * .15) + n) * 18 * f.z - par.y.value * 40 * f.z;
      let target = 0;
      if (tapped === n || kbd === n) target = 1;
      else if (finePointer && ptr.has) {
        const cx = r.left + f.px + ox + f.pw / 2, cy = r.top + f.py + oy + f.ph / 2;
        const d = Math.hypot(ptr.x - cx, ptr.y - cy), R = Math.max(160, Math.max(f.pw, f.ph) * .75);
        target = clamp(1.25 - d / R, 0, 1);
      }
      focusS[n].to(target); focusS[n].step(dt);
      el.style.setProperty("--f", focusS[n].value.toFixed(3));
      el.style.zIndex = Math.round(f.z * 10 + focusS[n].value * 20);
      el.style.transform = `translate3d(${(f.px + ox).toFixed(1)}px, ${(f.py + oy).toFixed(1)}px, 0) scale(${(1 + focusS[n].value * .06).toFixed(3)})`;
    });
    return true;
  }
  layoutField(); addEventListener("resize", layoutField);
  new IntersectionObserver(([en]) => { fieldOn = en.isIntersecting; if (fieldOn) animate(fieldTask); }).observe(field);
  fragEls.forEach((el, n) => {
    el.addEventListener("pointerup", e => { if (e.pointerType === "touch") el.dataset.touch = "1"; });
    el.addEventListener("click", () => {
      const touch = el.dataset.touch === "1"; delete el.dataset.touch;
      if (touch && tapped !== n) { tapped = n; animate(fieldTask); return; }   // first tap brings it into focus
      openSheet(FRAGS[n].i, el);
    });
    el.addEventListener("focus", () => { kbd = n; animate(fieldTask); });
    el.addEventListener("blur", () => { if (kbd === n) kbd = -1; });
  });

  /* ============================================================ detail sheet
     Opens out of the piece you tapped (anchored origin) and goes back into it when closed.
     Drag the handle down to dismiss: 1:1, rubber-banded upward, velocity-projected on release. */
  const sheet = $("#sheet"), scrim = $("#scrim"), sheetBody = $("#sheetBody"), handle = $("#sheetHandle");
  const open = new Spring(0, { damping: 1, response: .5, precision: .003 });
  const dragY = new Spring(0, { damping: 1, response: .35, precision: .2 });
  let flip = null, cleanup = null, opener = null, closing = false, sheetDrag = false, lastFrom = null;

  function renderSheet() {
    const t = open.value, H = sheet.offsetHeight || innerHeight;
    const f = flip || { dx: 0, dy: 0, sx: 1, sy: 1 };
    sheet.style.transform = `translate3d(${f.dx * (1 - t)}px, ${f.dy * (1 - t) + dragY.value}px, 0) scale(${lerp(f.sx, 1, t)}, ${lerp(f.sy, 1, t)})`;
    sheetBody.style.opacity = clamp((t - .35) / .65, 0, 1);
    $(".sheet__head", sheet).style.opacity = clamp((t - .25) / .6, 0, 1);
    scrim.style.opacity = t * (1 - clamp(dragY.value / H, 0, 1));
  }
  function sheetTask(dt) {
    open.step(dt);
    if (!sheetDrag) dragY.step(dt);
    document.body.classList.toggle("sheet-covered", !closing && !sheetDrag && open.value > .995 && dragY.value < 1);
    renderSheet();
    const H = sheet.offsetHeight;
    const gone = closing && ((open.target === 0 && open.value < .015) || (dragY.target > H && dragY.value >= H));
    if (gone) { hideSheet(); return false; }
    return sheetDrag || !(open.resting && dragY.resting);
  }

  function detailHTML(it, i) {
    const aside = `<aside class="detail__aside">
      <p>${it.text}</p>
      ${it.tryIt ? `<p class="detail__try">${it.tryIt}</p>` : ""}
      ${it.link ? `<a class="detail__link" href="${it.link}" target="_blank" rel="noopener">Visit ${it.link.replace(/^https?:\/\/(www\.)?|\/$/g, "")} ↗</a>` : ""}
    </aside>`;
    const gallery = (it.images || []).map(im => {
      const img = `<img src="${im.src}" alt="${im.alt.replace(/"/g, "&quot;")}">`;
      return `<figure>${it.url ? browser(it.url, img) : img}</figure>`;
    }).join("");
    const main = `<div class="detail__main">${it.site ? siteMarkup(it) : ""}${gallery ? `<div class="detail__gallery${it.url ? " is-screens" : ""}">${gallery}</div>` : ""}</div>`;
    return `<div class="detail">${main}${aside}</div>`;
  }

  function openSheet(i, fromEl) {
    if (!sheet.hidden && !closing) return;
    const it = ARCHIVE[i];
    opener = document.activeElement;
    closing = false;
    lastFrom = fromEl;
    $("#sheetTitle").textContent = it.title;
    sheetBody.innerHTML = detailHTML(it, i);
    sheetBody.scrollTop = 0;
    cleanup = it.site && SITES[it.site].bind ? SITES[it.site].bind($(".detail__main", sheetBody)) : null;
    sheet.hidden = scrim.hidden = false;
    root.classList.add("is-locked");
    sheet.style.transform = "none";
    const to = sheet.getBoundingClientRect(), from = fromEl.getBoundingClientRect();
    flip = { dx: from.left - to.left, dy: from.top - to.top, sx: from.width / to.width, sy: from.height / to.height };
    dragY.jump(0); open.jump(0); renderSheet();
    open.to(1, { damping: 1, response: .5 });
    animate(sheetTask);
    $("#sheetClose").focus({ preventScroll: true });
  }
  function closeSheet() {            // back along the path it came, into its piece
    if (sheet.hidden) return;
    closing = true;
    document.body.classList.remove("sheet-covered");
    const fromEl = lastFrom;
    if (fromEl) {
      const cur = sheet.style.transform; sheet.style.transform = "none";
      const to = sheet.getBoundingClientRect(), from = fromEl.getBoundingClientRect();
      sheet.style.transform = cur;
      flip = { dx: from.left - to.left, dy: from.top - to.top, sx: from.width / to.width, sy: from.height / to.height };
    }
    open.to(0, { damping: 1, response: .45 });
    animate(sheetTask);
  }
  function hideSheet() {
    document.body.classList.remove("sheet-covered");
    sheet.hidden = scrim.hidden = true;
    root.classList.remove("is-locked");
    cleanup && cleanup(); cleanup = null;
    sheetBody.innerHTML = "";
    closing = false;
    open.jump(0); dragY.jump(0);
    (opener && opener.focus ? opener : $(".frag")).focus({ preventScroll: true });
  }
  $("#sheetClose").addEventListener("click", closeSheet);
  scrim.addEventListener("click", closeSheet);
  addEventListener("keydown", e => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  // drag-to-dismiss on the handle
  (() => {
    const tr = velocityTracker();
    let s = null;
    handle.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      handle.setPointerCapture(e.pointerId);
      s = { id: e.pointerId, y: e.clientY, from: dragY.value, on: false };
      dragY.velocity = 0; tr.reset(); tr.add(0, e.clientY);
    });
    handle.addEventListener("pointermove", e => {
      if (!s || e.pointerId !== s.id) return;
      const dy = e.clientY - s.y;
      if (!s.on && Math.abs(dy) < 6) return;
      s.on = sheetDrag = true;
      tr.add(0, e.clientY);
      const raw = s.from + dy;
      dragY.jump(raw < 0 ? rubberband(raw, sheet.offsetHeight) : raw);   // resist upward, follow downward
      animate(sheetTask);
    });
    const up = e => {
      if (!s || e.pointerId !== s.id) return;
      const was = s.on; s = null; sheetDrag = false;
      if (!was) return;
      const v = tr.get().y, H = sheet.offsetHeight;
      if (dragY.value + project(v) > H * .35) {       // decide by where it's going, not where it is
        closing = true;
        dragY.to(H + 40, { velocity: v, damping: 1, response: .35 });
      } else {
        dragY.to(0, { velocity: v, damping: .8, response: .35 });
      }
      animate(sheetTask);
    };
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  })();

  /* ============================================================ services
     Ink floods each row from the point you enter and drains out the way you leave. */
  $$(".row").forEach(c => {
    const at = e => {
      const r = c.getBoundingClientRect();
      c.style.setProperty("--x", `${e.clientX - r.left}px`);
      c.style.setProperty("--y", `${e.clientY - r.top}px`);
    };
    c.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") { at(e); c.classList.add("is-wet"); } });
    c.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") { at(e); c.classList.remove("is-wet"); } });
    c.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") { at(e); c.classList.toggle("is-wet"); } });
  });

  /* ============================================================ contact
     Tap the address to copy it; the button itself says when it worked. */
  const mail = $("#mail"), ADDR = mail.textContent.trim();
  let mailTimer;
  mail.addEventListener("click", () => {
    const say = msg => { mail.textContent = msg; clearTimeout(mailTimer); mailTimer = setTimeout(() => { mail.textContent = ADDR; }, 1800); };
    const fallback = () => { const sel = getSelection(), range = document.createRange(); range.selectNodeContents(mail); sel.removeAllRanges(); sel.addRange(range); };
    try { navigator.clipboard.writeText(ADDR).then(() => say("Copied"), fallback); } catch (_) { fallback(); }
  });

  /* ============================================================ footer
     Letters lean up toward the pointer, each on its own spring. */
  const foot = $("#foot");
  const letters = $$("#footWord span:not(.sp)");
  const lift = letters.map(() => new Spring(0, { damping: 1, response: .35, precision: .05 }));
  function footTask(dt) {
    lift.forEach((s, i) => {
      s.step(dt);
      letters[i].style.transform = `translate3d(0, ${-s.value}px, 0) scaleY(${1 + s.value / 600})`;
      letters[i].classList.toggle("is-up", s.target > 4);
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

  /* ============================================================ navigation
     A block slides between items on a critically damped spring and moves on press.
     The bar darkens over black sections. */
  const bar = $("#bar");
  const nav = $("#nav");
  const navLinks = $$("a", nav);
  const navPill = $("#navPill");
  const sections = navLinks.map(a => $(a.getAttribute("href")));
  const darkZones = [$("#stage"), $(".archive"), $("#foot")];
  const pillX = new Spring(0, { damping: 1, response: .35, precision: .1 });
  const pillW = new Spring(0, { damping: 1, response: .35, precision: .1 });
  let active = -1, navLock = -1, navLockTimer;

  function pillTask(dt) {
    pillX.step(dt); pillW.step(dt);
    navPill.style.transform = `translate3d(${pillX.value}px, 0, 0)`;
    navPill.style.width = `${pillW.value}px`;
    return !(pillX.resting && pillW.resting);
  }
  function setActive(i, instant) {
    if (i === active && !instant) return;
    active = i;
    navLinks.forEach((a, j) => { a.classList.toggle("is-active", j === i); a.toggleAttribute("aria-current", j === i); });
    const l = navLinks[i];
    if (!l) { pillW.to(0); animate(pillTask); return; }
    if (instant || pillW.value < 1) { pillX.jump(l.offsetLeft); pillW.jump(l.offsetWidth); }
    else { pillX.to(l.offsetLeft); pillW.to(l.offsetWidth); }
    animate(pillTask);
  }
  const smooth = reduced ? "auto" : "smooth";
  navLinks.forEach((a, i) => {
    a.addEventListener("pointerdown", () => setActive(i));   // feedback on press
    a.addEventListener("click", e => {
      e.preventDefault();
      setActive(i);
      navLock = i; clearTimeout(navLockTimer);
      navLockTimer = setTimeout(() => { navLock = -1; onScroll(); }, 1200);
      sections[i].scrollIntoView({ behavior: smooth });
    });
  });
  $(".logo").addEventListener("click", e => { e.preventDefault(); scrollTo({ top: 0, behavior: smooth }); });
  addEventListener("scrollend", () => { if (navLock !== -1) { navLock = -1; onScroll(); } });

  /* ============================================================ scroll */
  let ticking = false;
  function onScroll() {
    if (navLock === -1) {
      let a = -1;
      sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top < innerHeight * .4) a = i; });
      setActive(a);
    }
    const y = bar.getBoundingClientRect().bottom - 20;
    const dark = darkZones.some(z => { const r = z.getBoundingClientRect(); return r.top <= y && r.bottom >= y; });
    bar.dataset.tone = dark ? "dark" : "light";
    ticking = false;
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener("resize", () => { setActive(active, true); onScroll(); });
  document.fonts && document.fonts.ready.then(() => { setActive(active, true); layoutField(); });
  onScroll();
})();
