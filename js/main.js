/* Wet Ink Studio: interactions
   Every effect is built on one idea: ink that is still wet. It spreads, pools,
   runs down the page and slowly dries. */
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

  /* Seeded random so every cover renders the same way on every visit */
  const rng = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---------------------------------------------------------------- intro */
  const intro = $(".intro");
  setTimeout(() => intro && intro.classList.add("done"), reduced ? 0 : 1600);

  /* --------------------------------------------------------- drying timer */
  const dryEl = $("#dryTimer");
  const t0 = Date.now();
  setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    dryEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  /* --------------------------------------------------------------- cursor */
  const cursor = $(".cursor");
  const cursorLabel = $(".cursor__label");
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  const cpos = { x: mouse.x, y: mouse.y };
  if (finePointer) {
    root.classList.add("has-cursor");
    addEventListener("pointermove", e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    addEventListener("pointerdown", () => cursor.classList.add("is-down"));
    addEventListener("pointerup", () => cursor.classList.remove("is-down"));
    document.addEventListener("pointerover", e => {
      const t = e.target.closest("[data-cursor], a, button, .cell");
      cursor.classList.remove("is-link", "is-view", "is-drag");
      if (!t) return;
      const mode = t.dataset.cursor || "link";
      cursor.classList.add("is-" + mode);
      cursorLabel.textContent = mode === "drag" ? "Drag" : mode === "view" ? "Open" : "";
    });
    const loop = () => {
      cpos.x = lerp(cpos.x, mouse.x, .25);
      cpos.y = lerp(cpos.y, mouse.y, .25);
      cursor.style.transform = `translate3d(${cpos.x}px, ${cpos.y}px, 0)`;
      requestAnimationFrame(loop);
    };
    loop();
  }

  /* ------------------------------------------------------- hero ink field
     Metaballs: soft circles are summed into a low-res alpha field, then
     thresholded. Pixels just over the threshold are painted darker, which
     gives the darker rim real ink leaves as it dries. */
  const hero = $(".hero");
  const canvas = $("#inkCanvas");
  const ctx = canvas.getContext("2d");
  const field = document.createElement("canvas");
  const fctx = field.getContext("2d", { willReadFrequently: true });
  const SCALE = 0.5; // field resolution relative to CSS pixels
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

  const MAX = 420;
  function spawn(p) {
    if (particles.length > MAX) particles.splice(0, particles.length - MAX);
    particles.push(Object.assign({ vx: 0, vy: 0, age: 0, grow: 1.25, life: 2.6, drip: false }, p));
    if (!inkRunning) { inkRunning = true; requestAnimationFrame(tickInk); }
  }

  function dropInk(x, y, size = 1) {
    const R = (34 + Math.random() * 30) * size;
    spawn({ x, y, r: R * .35, tr: R, life: 11, grow: 1 });
    const n = 7 + (Math.random() * 7 | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = R * (0.6 + Math.random() * 0.9);
      const sp = 140 + Math.random() * 260;
      spawn({ x: x + Math.cos(a) * d * .3, y: y + Math.sin(a) * d * .3, vx: Math.cos(a) * sp * size, vy: Math.sin(a) * sp * size,
              r: 3, tr: (5 + Math.random() * 12) * size, life: 7 + Math.random() * 4, grow: 1 });
    }
    // one or two runs that crawl down the page
    const runs = 1 + (Math.random() < .5 ? 1 : 0);
    for (let i = 0; i < runs; i++) {
      spawn({ x: x + (Math.random() - .5) * R, y: y + R * .4, vx: 0, vy: 60 + Math.random() * 60,
              r: 8, tr: 9 * size, life: 6 + Math.random() * 3, drip: true, grow: 1 });
    }
  }

  let lastTrail = null;
  hero.addEventListener("pointermove", e => {
    if (reduced) return;
    const r = hero.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (lastTrail) {
      const dx = x - lastTrail.x, dy = y - lastTrail.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 7) return;
      const speed = clamp(dist / 40, 0, 1);
      // fast strokes lay down thinner ink, like a dragged brush
      spawn({ x, y, r: 4, tr: lerp(22, 9, speed), life: 2.2 + Math.random(), vx: dx * .4, vy: dy * .4 });
    }
    lastTrail = { x, y };
  }, { passive: true });
  hero.addEventListener("pointerleave", () => { lastTrail = null; });
  hero.addEventListener("click", e => {
    if (e.target.closest("button, a")) return;
    const r = hero.getBoundingClientRect();
    dropInk(e.clientX - r.left, e.clientY - r.top, reduced ? .8 : 1);
  });

  const ioHero = new IntersectionObserver(([en]) => {
    heroVisible = en.isIntersecting;
    if (heroVisible && particles.length && !inkRunning) { inkRunning = true; requestAnimationFrame(tickInk); }
  });
  ioHero.observe(hero);

  let lastT = performance.now();
  const T = 120, RIM = 18;
  function tickInk(now) {
    const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
    if (!heroVisible) { inkRunning = false; return; }

    fctx.clearRect(0, 0, W, H);
    fctx.globalCompositeOperation = "lighter";
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { particles.splice(i, 1); continue; }
      // ease velocity out (paper soaks up the ink)
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(.02, dt); p.vy *= p.drip ? Math.pow(.55, dt) : Math.pow(.02, dt);
      if (p.drip && p.vy > 8 && Math.random() < .6) {
        spawn({ x: p.x + (Math.random() - .5) * 2, y: p.y, r: p.r * .8, tr: p.tr * (.75 + Math.random() * .2), life: 4 + Math.random() * 2 });
      }
      // bleed outward, then evaporate in the last 35% of life
      const grown = lerp(p.r, p.tr * p.grow, 1 - Math.pow(1 - Math.min(1, p.age * 2.2), 3));
      const rad = grown * (k > .65 ? 1 - (k - .65) / .35 : 1);
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
      if (a < T) { o[i - 3] = 150; o[i - 2] = 14; o[i - 1] = 10; o[i] = (a - T + 14) * 18; continue; } // anti-aliased edge
      if (a < T + RIM) { o[i - 3] = 150; o[i - 2] = 14; o[i - 1] = 10; }      // dried rim
      else { o[i - 3] = 226; o[i - 2] = 35; o[i - 1] = 26; }                  // wet red
      o[i] = 255;
    }
    ctx.putImageData(out, 0, 0);

    if (particles.length) requestAnimationFrame(tickInk);
    else { ctx.clearRect(0, 0, W, H); inkRunning = false; }
  }

  // a first drop, so the hero shows what it does before anyone touches it
  setTimeout(() => {
    const r = hero.getBoundingClientRect();
    dropInk(r.width * .8, r.height * .3, clamp(r.width / 1200, .55, 1.2));
  }, reduced ? 200 : 2100);

  if (!finePointer) $(".hero__hint").textContent = "Tap to drop ink";

  /* --------------------------------------------------------------- mascot */
  const mascot = $("#mascot");
  const pupils = $$(".pupil", mascot);
  if (!reduced) {
    addEventListener("pointermove", e => {
      const b = mascot.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height * .62;
      const a = Math.atan2(e.clientY - cy, e.clientX - cx);
      const d = clamp(Math.hypot(e.clientX - cx, e.clientY - cy) / 80, 0, 1) * 2.6;
      pupils.forEach(p => p.setAttribute("transform", `translate(${Math.cos(a) * d} ${Math.sin(a) * d})`));
    }, { passive: true });
  }
  mascot.addEventListener("click", () => {
    mascot.classList.remove("squish"); void mascot.offsetWidth; mascot.classList.add("squish");
    const b = mascot.getBoundingClientRect(), h = hero.getBoundingClientRect();
    dropInk(b.left - h.left + b.width / 2, b.bottom - h.top, .7);
  });

  /* ------------------------------------------------------- story chapter */
  const story = $(".story");
  const stack = $("#stack");
  const drop3d = $(".drop3d", stack);
  const steps = $$("#steps li");
  const lines = $$(".story__line");
  const bar = $("#storyBar");
  const discs = Array.from({ length: 5 }, () => {
    const d = document.createElement("div"); d.className = "disc"; stack.insertBefore(d, drop3d); return d;
  });

  function updateStory() {
    const r = story.getBoundingClientRect();
    const total = r.height - innerHeight;
    const p = clamp(-r.top / total, 0, 1);
    const h = stack.clientHeight;
    const spread = clamp(p * 2.2, 0, 1);                 // stack opens in the first half
    const gap = lerp(10, Math.min(h / 6.2, 110), 1 - Math.pow(1 - spread, 3));
    const spin = p * 220;
    const discY = [];
    discs.forEach((d, i) => {
      const y = (i - 2) * gap;
      discY.push(y);
      d.style.transform = `translate3d(0, ${y}px, 0) rotateX(72deg) rotateZ(${spin + i * 18}deg)`;
    });
    const top = -2 * gap - h * .32, bottom = 2 * gap + 30;
    const dp = clamp((p - .12) / .8, 0, 1);
    const dy = lerp(top, bottom, dp);
    const wob = Math.sin(p * 40) * .08;
    drop3d.style.transform = `translate3d(0, ${dy}px, 60px) scale(${1 - wob}, ${1 + wob})`;
    discs.forEach((d, i) => d.classList.toggle("is-lit", dy > discY[i] - 4));
    steps.forEach((s, i) => s.classList.toggle("is-on", dy > discY[i] - 4 || (i === 0 && p > .02)));
    const li = Math.min(lines.length - 1, Math.floor(p * lines.length * 1.02));
    lines.forEach((l, i) => l.classList.toggle("is-on", i === li));
    bar.style.transform = `scaleX(${p})`;
  }

  /* ------------------------------------------------------------- covers */
  const C = {
    paper: "#E8E3D6", ink: "#131214", wet: "#E2231A",
    pink: "#FF48B0", blue: "#0078BF", yellow: "#FFE800", green: "#00A95C"
  };

  function splatPath(rand, cx, cy, R) {
    const n = 36, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let r = R * (0.78 + rand() * 0.3);
      if (rand() < .16) r *= 1.35 + rand() * .5;          // a splash spike
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p1 = pts[(i + 1) % n], p2 = pts[(i + 2) % n];
      const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
      d += `Q${p1[0].toFixed(1)} ${p1[1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    return d + "Z";
  }

  function cover(seed, { bg, a, b, glyph, label, style = "splat" }) {
    const rand = rng(seed);
    const id = "h" + seed;
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
      <text x="22" y="34" font-family="JetBrains Mono, monospace" font-size="12" letter-spacing="1.2" fill="${C.ink}">${label.toUpperCase()}</text>
    </svg>`;
  }

  /* -------------------------------------------------------------- work */
  // Placeholder projects: swap in the studio's real work here.
  const PROJECTS = [
    { name: "Saltmarsh Press", tags: "Identity · Book series", year: 2026, seed: 11,
      art: { bg: C.paper, a: C.blue, b: C.wet, glyph: "Sp", style: "splat" },
      text: "A mark and cover system for a small press publishing coastal writing. Each spine carries one blot from the same drop, so the shelf reads as a single tide line.",
      spec: "Riso: Medium Blue + Red · 12 titles" },
    { name: "Oddly Coffee", tags: "Identity · Packaging", year: 2025, seed: 23,
      art: { bg: C.yellow, a: C.ink, b: C.wet, glyph: "Oc", style: "rings" },
      text: "Bags, cups and a roaster's stamp for a café that names its blends after weather. The ring stain is the logo.",
      spec: "Offset 2 spot · Rubber stamp" },
    { name: "Tinta Festival", tags: "Posters · Motion", year: 2025, seed: 37,
      art: { bg: C.paper, a: C.pink, b: C.ink, glyph: "Tf", style: "stripes" },
      text: "Posters and a title loop for a weekend of print workshops. Every poster was pulled live on the opening night, so no two match.",
      spec: "Riso: Fluorescent Pink + Black · 400 prints" },
    { name: "Hollow Hour", tags: "Film titles · 3D", year: 2024, seed: 41,
      art: { bg: C.ink, a: C.wet, b: C.paper, glyph: "Hh", style: "drips" },
      text: "Opening titles for a short documentary. Letterforms were painted in ink, scanned, then rebuilt in 3D so they could run and pool on screen.",
      spec: "Ink on paper · Houdini · 1:42" },
    { name: "Paper Weather", tags: "Zine · Risograph", year: 2024, seed: 53,
      art: { bg: C.paper, a: C.green, b: C.pink, glyph: "Pw", style: "splat" },
      text: "A quarterly zine of forecasts that never happened. Two drums, misregistered on purpose, so every copy has its own weather.",
      spec: "Riso: Green + Fluorescent Pink · 24 pp" },
    { name: "Moth & Meridian", tags: "Typeface · Packaging", year: 2026, seed: 67,
      art: { bg: C.blue, a: C.yellow, b: C.ink, glyph: "Mm", style: "rings" },
      text: "A display typeface drawn with a dip pen and the candle packaging it was made for. The counters stay open so the wax can show through.",
      spec: "Custom type · Foil + blind deboss" }
  ];
  PROJECTS.forEach(p => { p.svg = cover(p.seed, { ...p.art, label: p.name }); });

  const list = $("#worklist");
  list.innerHTML = PROJECTS.map((p, i) => `
    <li class="row">
      <button class="row__btn" type="button" data-cursor="view" data-i="${i}" aria-expanded="false" aria-controls="detail-${i}">
        <span class="row__name">${p.name}</span>
        <span class="row__tags">${p.tags}</span>
        <span class="row__year">${p.year}</span>
        <span class="row__arrow" aria-hidden="true">→</span>
      </button>
      <div class="row__detail" id="detail-${i}"><div>
        <div class="row__detailInner">
          <div><p>${p.text}</p><p class="mono">${p.spec}</p></div>
          <div class="row__cover">${p.svg.replace(/id="h(\d+)"/, 'id="d$1"').replace(/url\(#h(\d+)\)/, "url(#d$1)")}</div>
        </div>
      </div></div>
    </li>`).join("");

  list.addEventListener("click", e => {
    const btn = e.target.closest(".row__btn"); if (!btn) return;
    const row = btn.parentElement;
    const open = !row.classList.contains("is-open");
    $$(".row", list).forEach(r => { r.classList.remove("is-open"); $(".row__btn", r).setAttribute("aria-expanded", "false"); });
    row.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", String(open));
    if (open) preview.classList.remove("is-on");
  });

  // floating preview that trails the cursor with a little lag and tilt
  const preview = $("#preview");
  const previewInner = $("#previewInner");
  const pv = { x: 0, y: 0, tx: 0, ty: 0, run: false, cur: -1 };
  function pvLoop() {
    const px = pv.x;
    pv.x = lerp(pv.x, pv.tx, .14); pv.y = lerp(pv.y, pv.ty, .14);
    const tilt = clamp((pv.x - px) * .35, -12, 12);
    preview.style.transform = `translate3d(${pv.x}px, ${pv.y}px, 0) translate(-50%, -50%) rotate(${tilt}deg)`;
    if (pv.run) requestAnimationFrame(pvLoop);
  }
  if (finePointer) {
    list.addEventListener("pointermove", e => {
      pv.tx = e.clientX + 40; pv.ty = e.clientY;
      const btn = e.target.closest(".row__btn");
      $$(".row__btn", list).forEach(b => b.classList.toggle("is-hot", b === btn));
      list.classList.toggle("is-hovering", !!btn);
      if (!btn || btn.parentElement.classList.contains("is-open")) { preview.classList.remove("is-on"); return; }
      const i = +btn.dataset.i;
      if (i !== pv.cur) { pv.cur = i; previewInner.innerHTML = PROJECTS[i].svg; }
      if (!preview.classList.contains("is-on")) {
        if (!pv.run) { pv.x = pv.tx; pv.y = pv.ty; }
        preview.classList.add("is-on");
      }
      if (!pv.run) { pv.run = true; pvLoop(); }
    });
    list.addEventListener("pointerleave", () => {
      preview.classList.remove("is-on"); list.classList.remove("is-hovering");
      $$(".row__btn", list).forEach(b => b.classList.remove("is-hot"));
      pv.cur = -1; setTimeout(() => { if (!preview.classList.contains("is-on")) pv.run = false; }, 400);
    });
  }

  /* ------------------------------------------------------------ archive */
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
  const ring = $("#ring");
  const wheel = $("#wheel");
  const archiveName = $("#archiveName");
  ring.innerHTML = ARCHIVE.map(([label, bg, a, b, glyph, style], i) =>
    `<figure class="panel" style="margin:0">${cover(100 + i, { bg, a, b, glyph, label, style })}<figcaption>${String(i + 1).padStart(2, "0")} ${label}</figcaption></figure>`).join("");
  const panels = $$(".panel", ring);
  const N = panels.length, STEP = 360 / N;
  let radius = 0;
  function layoutWheel() {
    radius = ring.offsetWidth / (2 * Math.tan(Math.PI / N)) * 1.18;
    panels.forEach((p, i) => p.style.transform = `rotateY(${i * STEP}deg) translateZ(${radius}px)`);
  }
  layoutWheel();
  addEventListener("resize", layoutWheel);
  wheel.dataset.cursor = "drag";

  const wh = { rot: 0, vel: 0, drag: false, lastX: 0, inView: false, running: false, front: -1 };
  function wheelLoop() {
    if (!wh.drag) {
      wh.rot += wh.vel; wh.vel *= .94;
      if (Math.abs(wh.vel) < .02 && !reduced) wh.rot -= .08;      // slow idle spin
    }
    ring.style.transform = `translateZ(${-radius}px) rotateX(-7deg) rotateY(${wh.rot}deg)`;
    const front = ((Math.round(-wh.rot / STEP) % N) + N) % N;
    if (front !== wh.front) {
      wh.front = front; archiveName.textContent = ARCHIVE[front][0];
      panels.forEach((p, i) => {
        const d = Math.min(Math.abs(i - front), N - Math.abs(i - front));
        p.style.filter = `brightness(${1 - d * .14})`;
      });
    }
    if (wh.inView) requestAnimationFrame(wheelLoop); else wh.running = false;
  }
  new IntersectionObserver(([en]) => {
    wh.inView = en.isIntersecting;
    if (wh.inView && !wh.running) { wh.running = true; wheelLoop(); }
  }).observe(wheel);
  wheel.addEventListener("pointerdown", e => {
    wh.drag = true; wh.lastX = e.clientX; wh.vel = 0; wheel.setPointerCapture(e.pointerId);
  });
  wheel.addEventListener("pointermove", e => {
    if (!wh.drag) return;
    const dx = e.clientX - wh.lastX; wh.lastX = e.clientX;
    wh.rot += dx * .25; wh.vel = dx * .25;
  });
  const endDrag = () => { wh.drag = false; };
  wheel.addEventListener("pointerup", endDrag);
  wheel.addEventListener("pointercancel", endDrag);
  wheel.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { wh.vel = 0; wh.rot += STEP; }
    if (e.key === "ArrowRight") { wh.vel = 0; wh.rot -= STEP; }
  });

  /* ---------------------------------------------------- services flood */
  $$(".cell").forEach(c => {
    const set = e => {
      const r = c.getBoundingClientRect();
      c.style.setProperty("--x", `${e.clientX - r.left}px`);
      c.style.setProperty("--y", `${e.clientY - r.top}px`);
    };
    c.addEventListener("pointerenter", set);
    c.addEventListener("pointerleave", set);
  });

  /* --------------------------------------------------------- copy mail */
  const copyBtn = $("#copyMail"), copyState = $("#copyState"), mail = $("#mail");
  copyBtn.addEventListener("click", () => {
    const done = msg => { copyState.textContent = msg; setTimeout(() => copyState.textContent = "", 2400); };
    const fallback = () => {
      const sel = getSelection(), range = document.createRange();
      range.selectNodeContents(mail); sel.removeAllRanges(); sel.addRange(range);
      done("Selected. Press Ctrl+C to copy");
    };
    try {
      navigator.clipboard.writeText(mail.textContent.trim()).then(() => done("Copied"), fallback);
    } catch (_) { fallback(); }
  });

  /* ------------------------------------------------------ footer drips */
  $$("#footWord span:not(.sp)").forEach(s => {
    s.addEventListener("pointerenter", () => {
      s.classList.add("drip");
      clearTimeout(s._t); s._t = setTimeout(() => s.classList.remove("drip"), 1400);
    });
  });

  /* ------------------------------------------------------- scroll loop */
  const navLinks = $$(".nav a");
  const sections = navLinks.map(a => $(a.getAttribute("href")));
  let ticking = false;
  function onScroll() {
    updateStory();
    const mid = innerHeight * .4;
    let active = -1;
    sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top < mid) active = i; });
    navLinks.forEach((a, i) => a.classList.toggle("is-active", i === active));
    ticking = false;
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();
})();
