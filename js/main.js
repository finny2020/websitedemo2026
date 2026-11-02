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
      const vec3 BLACK = vec3(0.10, 0.094, 0.10);  const vec3 BLACK_RIM = vec3(0.035, 0.03, 0.035);
      const vec3 ORANGE = vec3(1.0, 0.416, 0.169); const vec3 ORANGE_RIM = vec3(0.76, 0.27, 0.06);
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

  const BLACK = 0, ORANGE = 1;
  /* A drop inherits the stroke's velocity, so a moving press throws its splash forward. */
  function dropInk(x, y, size = 1, vx = 0, vy = 0, color = BLACK, accent = .3) {
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

  // Continuous feedback: an orange trail follows the pointer anywhere on the page (mouse and pen).
  addEventListener("pointermove", e => {
    if (e.pointerType === "touch" || reduced || sheetOpen() || mascotState.active || archiveDragging()) { lastTrail = null; return; }
    const x = e.pageX, y = e.pageY;
    stroke.add(e.clientX, e.clientY);
    if (lastTrail) {
      const dx = x - lastTrail.x, dy = y - lastTrail.y, dist = Math.hypot(dx, dy);
      if (dist < 7) return;
      const speed = clamp(dist / 40, 0, 1);   // fast strokes lay thinner ink, like a dragged brush
      const n = Math.min(12, Math.ceil(dist / 8));   // fill the gap between events so the line stays continuous
      for (let i = 1; i <= n; i++) {
        ink.spawn({ x: lastTrail.x + dx * i / n, y: lastTrail.y + dy * i / n, r: 4, tr: lerp(16, 7, speed),
                    life: 1.9 + Math.random() * .6, vx: dx * .3, vy: dy * .3, c: ORANGE });
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
    dropInk(e.pageX, e.pageY, .9, v.x, v.y, ORANGE, .2);   // on black, the drop is orange
  });
  hero.addEventListener("pointerup", e => {
    if (e.pointerType !== "touch" || !touchStart) return;
    if (Math.hypot(e.pageX - touchStart.x, e.pageY - touchStart.y) < 10 && performance.now() - touchStart.t < 500) dropInk(e.pageX, e.pageY, .7, 0, 0, ORANGE, .2);
    touchStart = null;
  });
  hero.addEventListener("pointercancel", () => { touchStart = null; });
  if (!finePointer) $("#heroHint").textContent = "Tap to drop ink · Throw Blot";

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
    if (!reduced) ink.spawn({ x: m.x, y: m.y - m.w * .1, r: 4, tr: 9 + m.w * .12, life: 2.4, c: ORANGE });
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
        dropInk(lx, ly, .8, v.x, v.y, ORANGE, .25);
      }
      mx.to(0, { velocity: v.x, damping: .55, response: .5 });   // hand off the release velocity
      my.to(0, { velocity: v.y, damping: .55, response: .5 });
    } else {
      dropInk(m.x, m.y + 6, .6, 0, 0, ORANGE, .3);
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
    dropInk(m.x, m.y + 6, .6, 0, 0, ORANGE, .3);
    msy.to(1, { velocity: 5, damping: .4, response: .35 }); msx.to(1, { velocity: -4, damping: .4, response: .35 });
    animate(mascotTask);
  });

  /* ============================================================ object tunnel (hero signature)
     One real product, repeated on the walls of a tunnel that drifts toward you.
     Pointer position steers the vanishing point; pointer distance from it sets the tile scale
     (shown live in the HUD). "Next object" swaps the product with a spring.
     Two springs per axis, one for scale, one for the swap; drawn on a 2D canvas, paused off screen. */
  const tunnel = (() => {
    const cv = $("#tunnel"), ctx = cv.getContext("2d");
    const P = "assets/archive/";
    const OBJECTS = [
      { name: "Jus d'Art", src: P + "cut-carton.webp" },
      { name: "Loud Feet", src: P + "loud-feet-sock.webp" },
      { name: "Printing Studio", src: P + "cut-postcard-front.webp" },
      { name: "Quiet Luxury", src: P + "sock-left.webp" },
      { name: "Printing Studio, back", src: P + "cut-postcard-back.webp" }
    ];
    OBJECTS.forEach(o => { o.img = new Image(); o.img.decoding = "async"; o.img.src = o.src; o.img.onload = () => animate(task); });
    const hudScale = $("#hudScale"), hudIndex = $("#hudIndex"), hudName = $("#hudName");
    $("#hudTotal").textContent = String(OBJECTS.length).padStart(2, "0");

    let W = 0, H = 0, dpr = 1, visible = true, cur = 0, swapTo = -1, flight = 0, t = 0;
    const vx = new Spring(0, { damping: 1, response: .6, precision: .2 });
    const vy = new Spring(0, { damping: 1, response: .6, precision: .2 });
    const sc = new Spring(.84, { damping: 1, response: .35, precision: .002 });
    const pop = new Spring(1, { damping: .6, response: .4, precision: .002 });
    const tilt = new Spring(0, { damping: 1, response: .5, precision: .01 });
    const base = () => ({ x: W * (W < 720 ? .5 : .6), y: H * (W < 720 ? .3 : .42) });

    function size() {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const b = base(); vx.jump(b.x); vy.jump(b.y);
      animate(task);
    }

    const D = 14, GAP = .55, COLS = 6, ROWS = 4;
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const o = OBJECTS[cur], img = o.img;
      if (!img.complete || !img.naturalWidth) return;
      const asp = img.naturalWidth / img.naturalHeight;
      const cx = W / 2, cy = H / 2, hw = W * .62, hh = H * .66;
      const tile = Math.min(W, H) * .17 * sc.value;
      // tiles on the four walls, far to near
      const zs = [];
      for (let i = D - 1; i >= 0; i--) zs.push(1 + i * GAP - (flight % GAP));
      const per = [];
      for (let c = 0; c < COLS; c++) { const f = c / (COLS - 1) * 2 - 1; per.push([f * hw, -hh], [f * hw, hh]); }
      for (let r = 1; r < ROWS - 1; r++) { const f = r / (ROWS - 1) * 2 - 1; per.push([-hw, f * hh], [hw, f * hh]); }
      for (const z of zs) {
        const k = 1 / z, fog = Math.pow(clamp(1 - (z - 1) / (D * GAP), 0, 1), 1.4);
        if (fog <= .01) continue;
        ctx.globalAlpha = fog * .9;
        const h = tile * k, w = h * asp, hh2 = asp > 1.2 ? h / asp * 1.4 : h, ww2 = asp > 1.2 ? w / asp * 1.4 : w;
        for (const [x, y] of per) {
          const sx = cx + x * k + (vx.value - cx) * (1 - k), sy = cy + y * k + (vy.value - cy) * (1 - k);
          ctx.drawImage(img, sx - ww2 / 2, sy - hh2 / 2, ww2, hh2);
        }
      }
      // the hero object, at the vanishing point
      ctx.globalAlpha = 1;
      const big = Math.min(W * (asp > 1.2 ? .5 : .32), H * (W < 720 ? .3 : .5)) * (.75 + sc.value * .3) * pop.value;
      const bh = asp > 1.2 ? big / asp * 1.15 : big, bw = bh * asp;
      ctx.save();
      ctx.translate(vx.value, vy.value + Math.sin(t * 1.2) * (reduced ? 0 : 4));
      ctx.rotate(tilt.value);
      ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
      ctx.drawImage(img, -bw / 2, -bh / 2, bw, bh);
      ctx.restore();
    }

    function task(dt) {
      if (!visible) return false;
      if (!reduced) { flight += dt * .12; t += dt; }
      [vx, vy, sc, pop, tilt].forEach(s => s.step(dt));
      if (swapTo >= 0 && pop.value < .06) {   // the swap happens out of sight, then the new object pops in
        cur = swapTo; swapTo = -1; pop.to(1, { damping: .6, response: .4 });
        hudIndex.textContent = String(cur + 1).padStart(2, "0"); hudName.textContent = OBJECTS[cur].name;
      }
      hudScale.textContent = sc.value.toFixed(2);
      draw();
      return true;   // the tunnel drifts while it's on screen
    }

    const stage = $("#stage");
    stage.addEventListener("pointermove", e => {
      if (e.pointerType === "touch") return;
      const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, b = base();
      vx.to(b.x + (x - b.x) * .18); vy.to(b.y + (y - b.y) * .18);
      tilt.to(clamp((x - b.x) / W, -.5, .5) * .12);
      const d = Math.hypot(x - vx.value, y - vy.value) / (Math.hypot(W, H) * .5);
      sc.to(lerp(1, .38, clamp(d, 0, 1)));
    });
    stage.addEventListener("pointerleave", () => { const b = base(); vx.to(b.x); vy.to(b.y); tilt.to(0); sc.to(.84); });

    function next() {
      swapTo = (cur + 1) % OBJECTS.length;
      pop.to(0, { damping: 1, response: .22 });
      animate(task);
    }
    $("#nextObject").addEventListener("click", next);

    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) animate(task); }).observe(stage);
    document.addEventListener("visibilitychange", () => { visible = !document.hidden; if (visible) animate(task); });
    addEventListener("resize", size);
    size();
    return { next };
  })();

  /* ============================================================ team: roles on a hand-drawn line
     Each role is a pill you can drag 1:1 (rubber-banded to the table); throw it and it lands where its
     momentum carries it. A closed Catmull-Rom curve through the pills is redrawn every frame they move,
     with a second, slightly offset pass so the line reads as drawn by hand. Arrow keys nudge a focused pill. */
  const teamStage = $("#teamStage"), teamPath = $("#teamPath");
  const roles = $$(".role", teamStage).map(el => ({
    el, dx: parseFloat(el.dataset.x), dy: parseFloat(el.dataset.y), fx: 0, fy: 0,
    x: new Spring(0, { damping: .8, response: .45, precision: .1 }), y: new Spring(0, { damping: .8, response: .45, precision: .1 }), drag: null
  }));
  let TW = 0, TH = 0;
  const wob = rng(11);
  const jitter = roles.map(() => [wob() - .5, wob() - .5]);
  // phones: two columns of four around the title, staggered so the line still loops
  const MOBILE = [[.27,.06],[.73,.16],[.27,.26],[.73,.36],[.27,.64],[.73,.74],[.27,.84],[.73,.94]];
  let narrow = null;
  function teamLayout() {
    TW = teamStage.clientWidth; TH = teamStage.clientHeight;
    const n = TW < 640;
    if (n !== narrow) {   // breakpoint crossed: reset to that layout's home positions
      narrow = n;
      roles.forEach((r, i) => {
        if (n) { const m = MOBILE[[0, 1, 3, 5, 7, 6, 4, 2][i]]; r.fx = m[0]; r.fy = m[1]; } else { r.fx = r.dx; r.fy = r.dy; }
      });
    }
    teamStage.querySelector("svg").setAttribute("viewBox", `0 0 ${TW} ${TH}`);
    roles.forEach(r => { const mx = mX(r), my = mY(r); r.x.jump(clamp(r.fx * TW, mx, TW - mx)); r.y.jump(clamp(r.fy * TH, my, TH - my)); });
    drawTeam();
  }
  function curve(pts, off) {
    const n = pts.length; let d = "";
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 5 + jitter[i][0] * off, p1[1] + (p2[1] - p0[1]) / 5 + jitter[i][1] * off];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 5 - jitter[i][1] * off, p2[1] - (p3[1] - p1[1]) / 5 + jitter[i][0] * off];
      if (!i) d += `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
      d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }
  function drawTeam() {
    const pts = roles.map(r => {
      r.el.style.transform = `translate3d(${(r.x.value - r.el.offsetWidth / 2).toFixed(1)}px, ${(r.y.value - r.el.offsetHeight / 2).toFixed(1)}px, 0)`;
      return [r.x.value, r.y.value];
    });
    teamPath.setAttribute("d", curve(pts, 40) + " " + curve(pts, -55));   // two passes: a hand-drawn double line
  }
  function teamTask(dt) {
    roles.forEach(r => { if (!r.drag) { r.x.step(dt); r.y.step(dt); } });
    drawTeam();
    return roles.some(r => r.drag || !r.x.resting || !r.y.resting);
  }
  const mX = r => r.el.offsetWidth / 2 + 6, mY = r => r.el.offsetHeight / 2 + 6;   // keep the whole pill on the table
  const bound = (v, lo, hi, dim) => v < lo ? lo - rubberband(lo - v, dim) : v > hi ? hi + rubberband(v - hi, dim) : v;
  roles.forEach(r => {
    const tr = velocityTracker();
    r.el.tabIndex = 0;
    r.el.setAttribute("aria-roledescription", "draggable role");
    r.el.addEventListener("pointerdown", e => {
      r.el.setPointerCapture(e.pointerId); r.el.classList.add("is-grabbed");
      r.x.jump(r.x.value); r.y.jump(r.y.value);                  // catch it where it is
      r.drag = { gx: e.clientX - r.x.value, gy: e.clientY - r.y.value };   // keep the grab offset
      tr.reset(); tr.add(e.clientX, e.clientY);
      animate(teamTask);
    });
    r.el.addEventListener("pointermove", e => {
      if (!r.drag) return;
      tr.add(e.clientX, e.clientY);
      r.x.jump(bound(e.clientX - r.drag.gx, mX(r), TW - mX(r), TW)); r.y.jump(bound(e.clientY - r.drag.gy, mY(r), TH - mY(r), TH));
    });
    const up = () => {
      if (!r.drag) return;
      r.drag = null; r.el.classList.remove("is-grabbed");
      const v = tr.get();
      const tx = clamp(r.x.value + project(v.x, .99), mX(r), TW - mX(r)), ty = clamp(r.y.value + project(v.y, .99), mY(r), TH - mY(r));
      r.x.to(tx, { velocity: v.x, damping: .8, response: .45 }); r.y.to(ty, { velocity: v.y, damping: .8, response: .45 });
      r.fx = tx / TW; r.fy = ty / TH;
      animate(teamTask);
    };
    r.el.addEventListener("pointerup", up);
    r.el.addEventListener("pointercancel", up);
    r.el.addEventListener("keydown", e => {
      const k = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
      if (!k) return;
      e.preventDefault();
      const tx = clamp(r.x.target + k[0], mX(r), TW - mX(r)), ty = clamp(r.y.target + k[1], mY(r), TH - mY(r));
      r.x.to(tx, { damping: 1 }); r.y.to(ty, { damping: 1 }); r.fx = tx / TW; r.fy = ty / TH;
      animate(teamTask);
    });
  });
  addEventListener("resize", teamLayout);
  teamLayout();

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

  /* ============================================================ mock websites
     Each is a small, working site. Sizes are in container units (cqw), so the same markup
     reads correctly as a thumbnail on the wheel and full size in the sheet. */
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
    atlas: {
      url: "atlas.type",
      html: () => `<div class="site ws-atlas">
        <nav class="ws-nav"><b>Atlas</b><span>Fonts</span><span>Trials</span><span>Licences</span></nav>
        <p class="ws-specimen" data-spec contenteditable="true" spellcheck="false" style="--wght:800;--wdth:100%;--size:15cqw">Atlas Grotesk</p>
        <div class="ws-axes">
          <label>Weight <output data-o="wght">800</output><input type="range" min="100" max="900" value="800" data-axis="wght"></label>
          <label>Width <output data-o="wdth">100</output><input type="range" min="62" max="125" value="100" data-axis="wdth"></label>
          <label>Size <output data-o="size">15</output><input type="range" min="6" max="22" value="15" data-axis="size"></label>
        </div>
        <div class="ws-glyphs">${["A", "g", "R", "&", "?", "8", "ß", "✺"].map(g => `<span>${g}</span>`).join("")}</div>
      </div>`,
      bind(el) {
        const spec = $("[data-spec]", el);
        $$("[data-axis]", el).forEach(inp => inp.addEventListener("input", () => {
          const ax = inp.dataset.axis, v = inp.value;
          $(`[data-o="${ax}"]`, el).textContent = v;
          spec.style.setProperty(`--${ax}`, ax === "wght" ? v : ax === "wdth" ? `${v}%` : `${v}cqw`);
        }));
        $$(".ws-glyphs span", el).forEach(g => g.addEventListener("click", () => { spec.textContent = g.textContent.repeat(6); }));
      }
    },
    halo: {
      url: "halo.care",
      html: () => `<div class="site ws-halo">
        <nav class="ws-nav"><b>Halo</b><span>Care</span><span>Team</span><span>Book</span></nav>
        <h3>Unhurried care,<br>booked in a minute.</h3>
        <div class="ws-book">
          <div class="ws-row" data-days>${["Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16"].map((d, i) => `<button class="ws-chip${i === 1 ? " is-on" : ""}" type="button">${d}</button>`).join("")}</div>
          <div class="ws-row" data-times>${["09:00", "10:30", "13:00", "15:30"].map((d, i) => `<button class="ws-chip${i === 1 ? " is-on" : ""}" type="button">${d}</button>`).join("")}</div>
          <button class="ws-cta" type="button" data-book>Book appointment</button>
          <p class="ws-confirm" data-confirm role="status"></p>
        </div>
      </div>`,
      bind(el) {
        ["[data-days]", "[data-times]"].forEach(sel => {
          const chips = $$(`${sel} .ws-chip`, el);
          chips.forEach(c => c.addEventListener("click", () => chips.forEach(o => o.classList.toggle("is-on", o === c))));
        });
        $("[data-book]", el).addEventListener("click", () => {
          const d = $("[data-days] .is-on", el).textContent, t = $("[data-times] .is-on", el).textContent;
          $("[data-confirm]", el).textContent = `Booked for ${d} at ${t}. We'll send a reminder the day before.`;
        });
      }
    },
  };

  /* ============================================================ archive data */
  // Client work first, then concept studies (made for this site, labelled as such).
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
      text: "A die-cut postcard cut to the outline of the shop. The front is the shopfront; the back says “print with us and be remembered” and leaves room for a stamp." },
    { kind: "Website", site: "atlas", title: "Atlas Type Foundry", year: 2026, tags: ["Type tester", "Variable fonts", "Build"],
      text: "A foundry site where the type tester is the homepage. Every axis is a slider, every word is editable.",
      tryIt: "Move the sliders, type your own words, or tap a glyph." },
    { kind: "Website", site: "halo", title: "Halo Clinic", year: 2026, tags: ["Healthcare", "Booking", "Accessibility"],
      text: "A calm booking flow for a small clinic: two choices and one button, written in plain words, readable at any text size.",
      tryIt: "Pick a day and a time, then book." }
  ];

  /* ============================================================ archive wheel
     1:1 drag, flick projection, snap to the nearest piece, velocity handed to the spring.
     Grab it mid-spin to stop it. Tap the front piece to open it. */
  const ring = $("#ring"), wheel = $("#wheel");
  const archiveName = $("#archiveName"), archiveIndex = $("#archiveIndex"), archiveKind = $("#archiveKind");
  $("#archiveTotal").textContent = ARCHIVE.length;
  const kindLabel = it => it.client ? it.kind : `Concept ${it.kind.toLowerCase()}`;
  const siteMarkup = it => SITES[it.site].frame === false ? SITES[it.site].html() : browser(SITES[it.site].url, SITES[it.site].html());
  ring.innerHTML = ARCHIVE.map((it, i) => `<figure class="panel" data-i="${i}">${
    it.site ? siteMarkup(it)
    : it.url ? browser(it.url, `<img class="shot" src="${it.images[0].src}" alt="" draggable="false">`)
    : `<img src="${it.images[0].src}" alt="" draggable="false" style="object-fit:${it.fit};background:${it.bg}">`
  }<figcaption>${it.client ? it.kind : "Concept"}</figcaption></figure>`).join("");
  // thumbnails are pictures, not controls
  $$(".panel button, .panel input, .panel [contenteditable]", ring).forEach(n => { n.tabIndex = -1; n.removeAttribute("contenteditable"); });
  const panels = $$(".panel", ring);
  const N = panels.length, STEP = 360 / N;
  let radius = 0;
  const rot = new Spring(0, { damping: 1, response: .4, precision: .02 });
  const degPerPx = () => 180 / (Math.PI * radius);
  const wh = { down: false, dragging: false, id: null, x0: 0, y0: 0, rot0: 0, front: -1 };
  const archiveDragging = () => wh.dragging;
  const wtrack = velocityTracker();

  function layoutWheel() {
    radius = ring.offsetWidth / (2 * Math.tan(Math.PI / N)) * 1.2;
    panels.forEach((p, i) => p.style.transform = `rotateY(${i * STEP}deg) translateZ(${radius}px)`);
    renderWheel();
  }
  function renderWheel() {
    ring.style.transform = `translateZ(${-radius}px) rotateX(-7deg) rotateY(${rot.value}deg)`;
    const front = ((Math.round(-rot.value / STEP) % N) + N) % N;
    if (front !== wh.front) {
      wh.front = front;
      archiveName.textContent = ARCHIVE[front].title;
      archiveKind.textContent = kindLabel(ARCHIVE[front]);
      archiveIndex.textContent = String(front + 1).padStart(2, "0");
      panels.forEach((p, i) => {
        const d = Math.min(Math.abs(i - front), N - Math.abs(i - front));
        p.style.filter = d ? `brightness(${1 - d * .13})` : "";
        p.classList.toggle("is-front", !d);
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
    Object.assign(wh, { down: true, dragging: false, id: e.pointerId, x0: e.clientX, y0: e.clientY, rot0: rot.value, moving: !rot.resting });
    rot.target = rot.value; rot.velocity = 0;        // a grab stops it exactly where it is
    wtrack.reset(); wtrack.add(e.clientX, 0);
  });
  wheel.addEventListener("pointermove", e => {
    if (!wh.down || e.pointerId !== wh.id) return;
    const dx = e.clientX - wh.x0, dy = e.clientY - wh.y0;
    if (!wh.dragging) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) { wh.down = false; goTo(snap(rot.value)); return; }   // vertical: let the page scroll
      wh.dragging = true; wheel.classList.add("is-dragging");
      wheel.setPointerCapture(e.pointerId);
      wh.x0 = e.clientX; wh.rot0 = rot.value;
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
      const v = wtrack.get().x * degPerPx();
      goTo(snap(rot.value + project(v)), v);         // land where the flick is going
      return;
    }
    const panel = e.target.closest(".panel");
    if (!panel || e.type === "pointercancel") { goTo(snap(rot.value)); return; }
    const i = +panel.dataset.i;
    if (i === wh.front && !wh.moving) { goTo(snap(rot.value)); openSheet(i, panel); return; }   // tap the front piece: open it
    let t = -i * STEP;                                // tap a side piece: bring it forward the short way round
    t += Math.round((rot.value - t) / 360) * 360;
    goTo(t);
  }
  wheel.addEventListener("pointerup", endWheel);
  wheel.addEventListener("pointercancel", endWheel);

  let wheelIdle;
  wheel.addEventListener("wheel", e => {             // trackpad side-swipes turn it too
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    rot.jump(rot.value - e.deltaX * degPerPx());
    animate(wheelTask);
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => goTo(snap(rot.value)), 120);
  }, { passive: false });

  const stepBy = n => goTo(snap(rot.target) - n * STEP);   // stacks with repeated presses
  $("#prev").addEventListener("click", () => stepBy(-1));
  $("#next").addEventListener("click", () => stepBy(1));
  $("#openFront").addEventListener("click", () => openSheet(wh.front, panels[wh.front]));
  wheel.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { e.preventDefault(); stepBy(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); stepBy(1); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(wh.front, panels[wh.front]); }
  });

  /* ============================================================ detail sheet
     Opens out of the piece you tapped (anchored origin) and goes back into it when closed.
     Drag the handle down to dismiss: 1:1, rubber-banded upward, velocity-projected on release. */
  const sheet = $("#sheet"), scrim = $("#scrim"), sheetBody = $("#sheetBody"), handle = $("#sheetHandle");
  const open = new Spring(0, { damping: 1, response: .5, precision: .003 });
  const dragY = new Spring(0, { damping: 1, response: .35, precision: .2 });
  let flip = null, cleanup = null, opener = null, closing = false, sheetDrag = false;

  function renderSheet() {
    const t = open.value, H = sheet.offsetHeight || innerHeight;
    const f = flip || { dx: 0, dy: 0, sx: 1, sy: 1 };
    sheet.style.transform = `translate3d(${f.dx * (1 - t)}px, ${f.dy * (1 - t) + dragY.value}px, 0) scale(${lerp(f.sx, 1, t)}, ${lerp(f.sy, 1, t)})`;
    sheet.style.borderRadius = `${lerp(10, 24, t)}px ${lerp(10, 24, t)}px ${lerp(10, 0, t)}px ${lerp(10, 0, t)}px`;
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
      <div class="detail__tags label">${it.tags.map(t => `<span>${t}</span>`).join("")}</div>
      ${it.tryIt ? `<p class="detail__try"><b>Try it.</b> ${it.tryIt}</p>` : ""}
      ${it.link ? `<a class="detail__link" href="${it.link}" target="_blank" rel="noopener">Visit ${it.link.replace(/^https?:\/\/(www\.)?|\/$/g, "")} ↗</a>` : ""}
      ${it.client ? "" : `<p class="label muted">Concept study by Wet Ink, not client work.</p>`}
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
    $("#sheetMeta").textContent = it.client ? `${it.kind} · Client work` : `${it.kind} · Concept study · ${it.year}`;
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
    const fromEl = panels[wh.front];
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
    (opener && opener.focus ? opener : $("#openFront")).focus({ preventScroll: true });
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

  /* ============================================================ contact */
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
     A pill slides between items on a critically damped spring and moves on press.
     The capsule darkens over ink-black chapters. */
  const bar = $("#bar");
  const nav = $("#nav");
  const navLinks = $$("a", nav);
  const navPill = $("#navPill");
  const sections = navLinks.map(a => $(a.getAttribute("href")));
  const darkZones = [$("#stage"), $(".archive"), $(".contact"), $("#foot")];
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
  $$('.foot a[href="#top"]').forEach(a => a.addEventListener("click", e => { e.preventDefault(); scrollTo({ top: 0, behavior: smooth }); }));
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
  document.fonts && document.fonts.ready.then(() => { setActive(active, true); layoutWheel(); teamLayout(); });
  onScroll();
})();
