/* Wet Ink Studio: the 3D layer
   Real geometry with physically based materials, lit by a colourful studio environment, the way a Blender scene is:
   - an iridescent metaball form (marching cubes, vertex-coloured, clearcoat + sheen + thin-film)
   - a puffy bevelled chrome four-point star, a chrome hook, small chrome stars
   - "Wet ınk", "Archive" and the footer WET INK as extruded, bevelled chrome type, fitted exactly over the HTML text
   - Blot as a chrome teardrop with glossy eyes, following the (still draggable) HTML button
   One fixed transparent canvas, a perspective camera where 1 unit = 1 CSS pixel at z = 0, objects pinned to DOM anchors.
   If WebGL or this module fails, the HTML chrome text stays visible as the fallback. */
import * as THREE from "three";
import { MarchingCubes } from "../vendor/addons/MarchingCubes.js";
import { Font } from "../vendor/addons/FontLoader.js";

const WI = window.__wi || {};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function boot() {
  const canvas = document.createElement("canvas");
  canvas.className = "scene3d"; canvas.setAttribute("aria-hidden", "true");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(1.75, devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const [fontN, fontI] = await Promise.all(["assets/fonts/bodoni-moda-96.typeface.json", "assets/fonts/bodoni-moda-96-italic.typeface.json"]
    .map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); }).then(d => new Font(d))));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 10000);

  /* ---------- studio environment: a dark room with coloured softboxes (pink, cyan, lime, violet) ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0a0a10, side: THREE.BackSide })));
  const box = (color, k, w, h, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); room.add(m);
  };
  box(0xffffff, 6, 30, 8, [0, 22, 6], [0, 0, 0]);       // key softbox overhead
  box(0xff3ec8, 5, 14, 26, [-24, 2, 6], [0, 0, 0]);     // pink wall left
  box(0x6fe6ff, 5, 14, 26, [24, 4, 4], [0, 0, 0]);      // cyan wall right
  box(0xc6ff1a, 3, 30, 6, [0, -20, 10], [0, 0, 0]);     // lime floor bounce
  box(0x7a6bff, 4, 26, 16, [0, 6, -24], [0, 0, 0]);     // violet back
  box(0xffffff, 8, 6, 6, [10, 8, 22], [0, 0, 0]);       // small front kicker for crisp glints
  // a large gradient softbox behind the camera: flat chrome faces that look at us reflect this
  const gc = document.createElement("canvas"); gc.width = 4; gc.height = 256;
  const g2 = gc.getContext("2d"), lg = g2.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, "#ffd1f3"); lg.addColorStop(.35, "#ffffff"); lg.addColorStop(.55, "#b9a8ff"); lg.addColorStop(.75, "#9fe9ff"); lg.addColorStop(1, "#e9ffc4");
  g2.fillStyle = lg; g2.fillRect(0, 0, 4, 256);
  const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshBasicMaterial({ map: gt, color: new THREE.Color(1, 1, 1).multiplyScalar(2.2), side: THREE.DoubleSide }));
  front.position.set(0, 0, 26); front.lookAt(0, 0, 0); room.add(front);
  scene.environment = pmrem.fromScene(room, 0.02).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-1, 1.4, 1.2); scene.add(key);

  /* ---------- materials ---------- */
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 1, roughness: .07, envMapIntensity: 1.25,
    iridescence: .85, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 900], clearcoat: 1, clearcoatRoughness: .04
  });
  const chromeStar = chrome.clone(); chromeStar.iridescence = 1; chromeStar.iridescenceThicknessRange = [120, 1200];
  const blobMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: .42, metalness: 0, envMapIntensity: .42, clearcoat: 1, clearcoatRoughness: .1,
    iridescence: .35, iridescenceIOR: 1.3, iridescenceThicknessRange: [300, 700], sheen: .35, sheenColor: new THREE.Color(0x9fe9ff), sheenRoughness: .45
  });
  const gloss = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: .12, metalness: 0, clearcoat: 1, clearcoatRoughness: .05 });
  const white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .2, emissive: 0xffffff, emissiveIntensity: .35 });

  /* ---------- extruded type, fitted to HTML elements ---------- */
  const bl = new Map();   // baseline markers
  function baselineOf(el) {
    let m = bl.get(el);
    if (!m) { m = document.createElement("i"); m.className = "bl"; el.appendChild(m); bl.set(el, m); }
    return m.getBoundingClientRect().top;
  }
  function textGeometry(font, text, ls) {
    const shapes = [];
    let x = 0;
    for (const ch of text) {
      const g = font.data.glyphs[ch];
      if (!g) continue;
      const s = font.generateShapes(ch, 1);
      s.forEach(sh => shapes.push(Object.assign(sh, { _dx: x })));
      x += g.ha / font.data.resolution + ls;
    }
    const geos = shapes.map(sh => {
      const geo = new THREE.ExtrudeGeometry(sh, { depth: .07, curveSegments: 10, bevelEnabled: true, bevelThickness: .016, bevelSize: .0065, bevelSegments: 5 });
      geo.translate(sh._dx, 0, -.035);
      return geo;
    });
    const merged = mergeGeometries(geos); geos.forEach(g => g.dispose());
    return merged;
  }
  function mergeGeometries(list) {
    let n = 0; list.forEach(g => n += (g.index ? g.index.count : g.attributes.position.count));
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    list.forEach(g => {
      const ng = g.index ? g.toNonIndexed() : g;
      pos.set(ng.attributes.position.array, o * 3); nor.set(ng.attributes.normal.array, o * 3); o += ng.attributes.position.count;
      if (ng !== g) ng.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    return out;
  }
  const typeItems = [];
  function addType(el, font, mat = chrome, opts = {}) {
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
    if (!text) return;
    const item = { el, font, mat, text, mesh: null, fs: 0, ls: 0, ...opts };
    typeItems.push(item);
  }
  function syncType(item, W, H) {
    const cs = getComputedStyle(item.el), fs = parseFloat(cs.fontSize), ls = (parseFloat(cs.letterSpacing) || 0) / fs;
    if (!item.mesh || Math.abs(fs - item.fs) > .5 || Math.abs(ls - item.ls) > .001) {
      if (item.mesh) { scene.remove(item.mesh); item.mesh.geometry.dispose(); }
      item.mesh = new THREE.Mesh(textGeometry(item.font, item.text, ls), item.mat);
      item.fs = fs; item.ls = ls; scene.add(item.mesh);
    }
    const r = item.el.getBoundingClientRect(), base = baselineOf(item.el);
    item.mesh.scale.set(fs, fs, fs);
    item.mesh.position.set(r.left - W / 2, H / 2 - base, item.z || 0);
    item.mesh.rotation.y = item.tilt ? item.tilt() : 0;
    item.mesh.visible = r.bottom > -fs && r.top < H + fs;
    return item.mesh.visible;
  }
  addType($(".mega__line:first-child .mega__rise"), fontN);
  addType($(".tittle-host"), fontI);
  addType($(".mega__rise--2 > .chrome:not(.tittle-host)"), fontI);
  addType($(".archive__title em"), fontI);
  $$(".foot__word span:not(.sp)").forEach(s => addType(s, fontN));
  // a little life in the type: it turns a few degrees toward the pointer
  const tiltTarget = () => WI.ptr && WI.ptr.has && !reduced ? ((WI.ptr.x / innerWidth) - .5) * .35 : 0;
  let tilt = 0;
  typeItems.forEach(it => it.tilt = () => tilt);

  /* ---------- the iridescent form: marching-cubes metaballs ---------- */
  const blob = new MarchingCubes(46, blobMat, false, true, 60000);
  blob.isolation = 60;
  scene.add(blob);
  const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  const BALLCOL = [srgb(1, .16, .7), srgb(.36, .2, 1), srgb(.35, .75, 1), srgb(1, .45, .55), srgb(.78, .2, 1), srgb(1, .2, .72)];
  const press = { v: 0, t: 0 }, follow = { x: 0, y: 0 };

  /* ---------- puffy chrome star (bevelled extrusion of a concave four-point shape) ---------- */
  const starShape = new THREE.Shape();
  const c = .16;
  starShape.moveTo(0, 1); starShape.quadraticCurveTo(c, c, 1, 0); starShape.quadraticCurveTo(c, -c, 0, -1);
  starShape.quadraticCurveTo(-c, -c, -1, 0); starShape.quadraticCurveTo(-c, c, 0, 1);
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: .12, curveSegments: 28, bevelEnabled: true, bevelThickness: .24, bevelSize: .16, bevelSegments: 12 });
  starGeo.center(); starGeo.computeVertexNormals();
  const star = new THREE.Mesh(starGeo, chromeStar); scene.add(star);
  const minis = Array.from({ length: 7 }, (_, i) => { const m = new THREE.Mesh(starGeo, chromeStar); m.userData = { a: i / 7 * Math.PI * 2, r: .55 + (i % 3) * .14, sp: .25 + (i % 4) * .07, ph: i * 1.3 }; scene.add(m); return m; });

  /* ---------- chrome hook (the moodboard's swirl) ---------- */
  const hook = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1, -1.1, 0), new THREE.Vector3(-.55, -.9, .2), new THREE.Vector3(-.3, -.2, 0), new THREE.Vector3(-.35, .45, -.2),
    new THREE.Vector3(-.1, .95, 0), new THREE.Vector3(.3, 1, .15), new THREE.Vector3(.4, .7, .1), new THREE.Vector3(.2, .55, 0)
  ]), 200, .07, 24, false), chrome);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(.07, 24, 16), chrome); cap.position.set(.2, .55, 0); hook.add(cap);
  const cap2 = cap.clone(); cap2.position.set(-1, -1.1, 0); hook.add(cap2);
  scene.add(hook);

  /* ---------- Blot: a chrome teardrop with glossy eyes ---------- */
  const prof = [];
  for (let i = 0; i <= 24; i++) { const a = -Math.PI / 2 + i / 24 * (Math.PI / 2 + Math.asin(1 / 1.3)); prof.push(new THREE.Vector2(Math.max(0.0001, Math.cos(a)), Math.sin(a))); }
  prof.push(new THREE.Vector2(.0001, 1.3));
  const blot = new THREE.Group();
  const drop = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), new THREE.MeshPhysicalMaterial({
    color: 0xff4fcf, roughness: .18, metalness: 0, envMapIntensity: .7, clearcoat: 1, clearcoatRoughness: .04,
    iridescence: .5, iridescenceIOR: 1.4, iridescenceThicknessRange: [200, 600], sheen: .6, sheenColor: new THREE.Color(0x9fe9ff) }));
  blot.add(drop);
  const eyeGeo = new THREE.SphereGeometry(1, 24, 16), pupils = [];
  [-1, 1].forEach(s => {
    const eye = new THREE.Mesh(eyeGeo, gloss); eye.scale.set(.2, .25, .1); eye.position.set(s * .36, -.05, .9); blot.add(eye);
    const p = new THREE.Mesh(eyeGeo, white); p.scale.set(.075, .075, .04); p.position.set(s * .36, -.03, 1.0); blot.add(p); pupils.push(p);
  });
  scene.add(blot);
  const mascotEl = $("#mascot");

  /* ---------- 3D glints: small chrome stars spawned at the pointer and on press ---------- */
  const glints = Array.from({ length: 26 }, () => { const m = new THREE.Mesh(starGeo, chromeStar); m.visible = false; m.userData = { life: 0, age: 1 }; scene.add(m); return m; });
  let gi = 0, acc = 0, last = null;
  function glint(px, py, size = 10, life = 1) {
    const m = glints[gi++ % glints.length];
    Object.assign(m.userData, { px, py, size, life, age: 0, spin: (Math.random() - .5) * 4, vy: -12 - Math.random() * 18 });
    m.visible = true;
  }
  addEventListener("pointermove", e => {
    if (reduced || e.pointerType === "touch" || !$("#sheet").hidden) return;
    if (last) acc += Math.hypot(e.pageX - last.x, e.pageY - last.y);
    last = { x: e.pageX, y: e.pageY };
    if (acc > 80) { acc = 0; glint(e.pageX + (Math.random() - .5) * 20, e.pageY + (Math.random() - .5) * 20, 6 + Math.random() * 7, .9 + Math.random() * .5); kick(); }
  }, { passive: true });
  const hero = $("#stage");
  hero.addEventListener("pointerdown", e => {
    if (e.target.closest("a")) return;
    press.t = 1;
    if (!reduced) for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, d = 20 + Math.random() * 40; glint(e.pageX + Math.cos(a) * d, e.pageY + Math.sin(a) * d, 8 + Math.random() * 10, 1 + Math.random() * .6); }
    kick();
  });
  addEventListener("pointerup", () => { press.t = 0; });

  /* ---------- frame ---------- */
  let W = 0, H = 0;
  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.position.set(0, 0, (H / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.near = 10; camera.far = camera.position.z * 3; camera.updateProjectionMatrix();
  }
  resize(); addEventListener("resize", () => { resize(); kick(); });

  let t = 0, prev = performance.now(), raf = 0;
  const archiveTitle = $(".archive__title"), foot = $("#foot");
  function onScreen(el, pad = 0) { const r = el.getBoundingClientRect(); return r.bottom > -pad && r.top < H + pad; }
  function frame(now) {
    raf = 0;
    const dt = Math.min(.05, (now - prev) / 1000); prev = now;
    if (!reduced) t += dt;
    const heroOn = onScreen(hero), anyGlint = glints.some(g => g.visible);
    const live = heroOn || onScreen(archiveTitle, 200) || onScreen(foot, 200) || anyGlint;
    if (!live) { renderer.clear(); return; }

    tilt += (tiltTarget() - tilt) * Math.min(1, dt * 4);
    let any = false; typeItems.forEach(it => { if (syncType(it, W, H)) any = true; });

    // hero objects
    const hr = hero.getBoundingClientRect(), narrow = hr.width < 720;
    blob.visible = star.visible = hook.visible = heroOn;
    minis.forEach(m => m.visible = heroOn);
    if (heroOn) {
      const cx = hr.left + hr.width * (narrow ? .5 : .64) - W / 2, cy = H / 2 - (hr.top + hr.height * (narrow ? .3 : .42));
      const size = narrow ? hr.width * 1.05 : Math.min(hr.width * .5, hr.height * .95);
      blob.position.set(cx, cy, -size * .2); blob.scale.setScalar(size / 2);
      blob.rotation.y = t * .12; blob.rotation.x = Math.sin(t * .2) * .15;
      // pointer pull, in blob space
      if (WI.ptr && WI.ptr.has && !reduced) {
        const tx = clamp((WI.ptr.x - (cx + W / 2)) / (size / 2), -1, 1) * .28, ty = clamp(-(WI.ptr.y - (H / 2 - cy)) / (size / 2), -1, 1) * .28;
        follow.x += (tx - follow.x) * Math.min(1, dt * 2.5); follow.y += (ty - follow.y) * Math.min(1, dt * 2.5);
      }
      press.v += ((press.t ? 1 : 0) - press.v) * Math.min(1, dt * (press.t ? 8 : 3));
      blob.reset();
      const k = t * .45, S = 1.15, sub = 10;
      const balls = [
        [.5 + Math.sin(k) * .08, .5 + Math.cos(k * .8) * .07, .5, S],
        [.5 + Math.cos(k * 1.3) * .16, .58 + Math.sin(k * .9) * .12, .5 + Math.sin(k) * .06, S * .75],
        [.5 + Math.sin(k * .7 + 2) * .14, .36 + Math.cos(k * 1.1) * .06, .5 + Math.cos(k * .6) * .09, S * .8],
        [.36 + Math.sin(k * 1.7) * .06, .64 + Math.cos(k * 1.3) * .05, .52, S * .6],
        [.66 + Math.cos(k * .9) * .05, .44 + Math.sin(k * 1.4) * .08, .48, S * .55],
        [.5 + follow.x, .5 + follow.y, .58, S * (.5 + press.v * .45)]
      ];
      balls.forEach((b, i) => blob.addBall(b[0], b[1], b[2], b[3], sub, BALLCOL[i]));
      blob.update();

      const ss = narrow ? 46 : clamp(hr.width * .055, 50, 90);
      star.scale.setScalar(ss);
      star.position.set(hr.left + hr.width * (narrow ? .8 : .82) - W / 2, H / 2 - (hr.top + hr.height * (narrow ? .14 : .2)) + Math.sin(t * 1.1) * 8, 60);
      star.rotation.set(Math.sin(t * .6) * .35 + tilt * .6, t * .7 + tilt * 2, Math.sin(t * .4) * .2);

      hook.scale.setScalar(narrow ? hr.width * .08 : size * .12);
      hook.position.set(cx + size * (narrow ? .3 : .42), cy - size * (narrow ? .36 : .42), 40);
      hook.rotation.set(Math.sin(t * .5) * .2, Math.sin(t * .35) * .5 + tilt, -.3);

      minis.forEach((m, i) => {
        const u = m.userData, a = u.a + t * u.sp, tw = Math.pow(Math.max(0, Math.sin(t * 1.3 + u.ph)), 3);
        m.scale.setScalar((narrow ? 9 : 14) * (.2 + tw));
        m.position.set(cx + Math.cos(a) * size * u.r * .62, cy + Math.sin(a) * size * u.r * .5, 80 + Math.sin(a) * 60);
        m.rotation.set(t, t * 1.3 + i, 0);
      });
    }

    // Blot follows its HTML button (which keeps all the drag and throw physics)
    const br = mascotEl.getBoundingClientRect();
    blot.visible = br.bottom > 0 && br.top < H;
    if (blot.visible) {
      const h = mascotEl.offsetHeight, s = h / 2.35;
      blot.position.set(br.left + br.width / 2 - W / 2, H / 2 - (br.top + br.height * .58), 30);
      blot.scale.set(s * (WI.msx ? WI.msx.value : 1), s * (WI.msy ? WI.msy.value : 1), s);
      blot.rotation.set(tilt * .3, Math.sin(t * .8) * .25 + tilt * 1.5, 0);
      if (WI.px) pupils.forEach((p, i) => { p.position.x = (i ? .36 : -.36) + WI.px.value * .03; p.position.y = -.03 - WI.py.value * .03; });
    }

    // glints
    glints.forEach(m => {
      const u = m.userData; if (!m.visible) return;
      u.age += dt; if (u.age >= u.life) { m.visible = false; return; }
      u.py += u.vy * dt;
      const k = Math.pow(Math.sin(Math.PI * u.age / u.life), 1.5);
      m.scale.setScalar(u.size * k); m.rotation.set(u.age * 2, u.age * u.spin, 0);
      m.position.set(u.px - scrollX - W / 2, H / 2 - (u.py - scrollY), 120);
    });

    renderer.render(scene, camera);
    kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  addEventListener("scroll", kick, { passive: true });
  addEventListener("pointermove", kick, { passive: true });

  document.body.appendChild(canvas);
  renderer.compile(scene, camera);
  document.documentElement.classList.add("has3d");
  kick();
}

if (window.WebGLRenderingContext) boot().catch(err => { console.warn("3D layer off:", err); });
