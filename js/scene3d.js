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
  const chromeStar = chrome.clone(); chromeStar.iridescence = 1; chromeStar.iridescenceIOR = 2; chromeStar.iridescenceThicknessRange = [100, 1100]; chromeStar.roughness = .1; chromeStar.color.set(0xfff6fd);
  const blobMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: .42, metalness: 0, envMapIntensity: .42, clearcoat: 1, clearcoatRoughness: .1,
    iridescence: .6, iridescenceIOR: 1.35, iridescenceThicknessRange: [300, 700], sheen: .35, sheenColor: new THREE.Color(0x9fe9ff), sheenRoughness: .45
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
  const BALLCOL = [srgb(1, .5, .84), srgb(.66, .5, 1), srgb(.62, .84, 1), srgb(1, .72, .76), srgb(.9, .56, 1), srgb(1, .56, .86)];
  const press = { v: 0, t: 0 }, follow = { x: 0, y: 0 };

  /* ---------- puffy chrome star (bevelled extrusion of a concave four-point shape) ---------- */
  // inflated four-point star: a sphere pushed out along four arms, thin at the tips, puffy in the middle
  const starGeo = new THREE.SphereGeometry(1, 128, 96);
  {
    const p = starGeo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const rho = Math.hypot(v.x, v.y), a = Math.atan2(v.y, v.x), P = .62;
      // concave astroid outline: tips on the axes, soft scooped sides between them
      const R = Math.pow(Math.pow(Math.abs(Math.cos(a)), P) + Math.pow(Math.abs(Math.sin(a)), P), -1 / P);
      const z = v.z * .72 * (1 - .22 * rho * rho);
      p.setXYZ(i, v.x * R, v.y * R * 1.2, z);
    }
    starGeo.computeVertexNormals();
  }
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

  /* ---------- concept studies (archive strip): five objects after the moodboards ---------- */
  const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y, z) => {   // smooth value noise, enough for organic displacement
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
    return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
  };
  function displace(geo, fn) {
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, i); p.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals(); return geo;
  }
  const studies = {};
  // Pearl: an irregular baroque pearl, nacre white with an oil-slick sheen
  {
    const g = displace(new THREE.IcosahedronGeometry(1, 48), v => {
      const n = vnoise(v.x * 1.6 + 3, v.y * 1.6, v.z * 1.6) * .32 + vnoise(v.x * 4, v.y * 4, v.z * 4) * .06;
      v.multiplyScalar(1 + n - .18).multiply(new THREE.Vector3(1.15, .9, 1));
    });
    studies.pearl = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: 0xfff4fb, roughness: .16, metalness: .15, clearcoat: 1, clearcoatRoughness: .05,
      iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 820], sheen: 1, sheenColor: new THREE.Color(0xffc9ee), envMapIntensity: 1.1 }));
  }
  // Orbit: a clear glass sphere with a glass ribbon wrapped round it (from the motion clip)
  {
    const grp = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: .9, roughness: .04, ior: 1.42, metalness: 0,
      iridescence: .7, iridescenceIOR: 1.5, iridescenceThicknessRange: [200, 700], clearcoat: 1, envMapIntensity: 1.3, transparent: true });
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(.82, 64, 48), glass));
    const pts = []; for (let i = 0; i <= 120; i++) { const t = i / 120 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * .9, Math.sin(t * 2) * .22 + Math.sin(t) * .15, Math.sin(t) * .9)); }
    const band = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 240, .13, 24, true), glass);
    band.scale.set(1, 1.4, 1); band.rotation.z = .55; grp.add(band);
    studies.orbit = grp;
  }
  // Fuzz: a bumpy, speckled U-shaped squiggle (flocked texture study)
  {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-.55, -.7, 0), new THREE.Vector3(-.6, .25, .1), new THREE.Vector3(-.3, .75, 0), new THREE.Vector3(.3, .75, -.05), new THREE.Vector3(.6, .2, .05), new THREE.Vector3(.45, -.55, 0)]);
    const g = new THREE.TubeGeometry(curve, 160, .26, 40, false);
    const cols = new Float32Array(g.attributes.position.count * 3), base = new THREE.Color(0xc6ff1a), spot = new THREE.Color(0x6b4cff), dark = new THREE.Color(0x1d2a05);
    displace(g, (v, i) => {
      const k = vnoise(v.x * 9, v.y * 9, v.z * 9), bump = (k - .5) * .05 + (hash3(v.x * 60, v.y * 60, v.z * 60) - .5) * .012;
      const r = Math.hypot(v.x, v.y, v.z) || 1; v.multiplyScalar(1 + bump / r);
      const sp = hash3(Math.round(v.x * 22), Math.round(v.y * 22), Math.round(v.z * 22));
      const c = sp > .93 ? spot : sp > .86 ? dark : base; cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    });
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    const caps = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: .78, sheen: 1, sheenRoughness: .3, sheenColor: new THREE.Color(0xf2ffd0), envMapIntensity: .55 });
    caps.add(new THREE.Mesh(g, mat));
    const capMat = new THREE.MeshPhysicalMaterial({ color: base, roughness: .78, sheen: 1, sheenRoughness: .3, sheenColor: new THREE.Color(0xf2ffd0), envMapIntensity: .55 });
    [curve.getPoint(0), curve.getPoint(1)].forEach(p => { const b = new THREE.Mesh(new THREE.SphereGeometry(.27, 32, 24), capMat); b.position.copy(p); caps.add(b); });
    studies.fuzz = caps;
  }
  // Coral: a glossy branching form in dreamy pink with water droplets
  {
    const grp = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(1, .62, .82, THREE.SRGBColorSpace), roughness: .22, clearcoat: 1, clearcoatRoughness: .06,
      sheen: .8, sheenColor: new THREE.Color(0xffe0f4), envMapIntensity: .7 });
    const branch = (pts, r) => { const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))); grp.add(new THREE.Mesh(new THREE.TubeGeometry(c, 60, r, 24, false), mat));
      [c.getPoint(0), c.getPoint(1)].forEach(p => { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat); b.position.copy(p); grp.add(b); }); };
    branch([[0, -.9, 0], [.05, -.3, 0], [-.05, .3, .05], [.05, .85, 0]], .17);
    branch([[0, -.35, 0], [-.35, -.2, .05], [-.6, .05, 0], [-.62, .4, 0]], .13);
    branch([[0, .05, 0], [.35, .12, -.05], [.62, .4, 0], [.6, .7, .05]], .12);
    branch([[-.42, -.12, 0], [-.7, -.45, .05]], .1);
    branch([[.4, .2, 0], [.75, .05, 0]], .09);
    const drop = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: .2, roughness: 0, ior: 1.33, transparent: true, envMapIntensity: 1.4 });
    [[.14, .2, .16, .07], [-.5, .25, .13, .05], [.5, .55, .12, .045], [-.05, -.55, .17, .055], [.28, .14, .1, .035]].forEach(([x, y, z, r]) => {
      const d = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), drop); d.position.set(x, y, z); d.scale.z = .6; grp.add(d); });
    studies.coral = grp;
  }
  // Melt: a polished chrome slab melting into drips
  {
    const g = displace(new THREE.IcosahedronGeometry(1, 64), v => {
      const a = Math.atan2(v.z, v.x);
      const drip = Math.pow(Math.max(0, Math.sin(a * 5 + 1.3)), 8) * 1.1 + Math.pow(Math.max(0, Math.sin(a * 3 - .4)), 14) * .7;
      v.y *= .5;
      if (v.y < 0) { const k = Math.pow(-v.y / .5, 2); v.y -= drip * k * .6; const pinch = 1 - drip * k * .28; v.x *= pinch; v.z *= pinch; }
      const n = vnoise(v.x * 2.5 + 7, v.y * 2.5, v.z * 2.5) * .14; v.x *= 1 + n; v.z *= 1 + n;
    });
    g.center();
    const m = chrome.clone(); m.roughness = .04; m.iridescence = .6;
    studies.melt = new THREE.Mesh(g, m);
  }
  const pieceEls = $$(".piece[data-obj]");
  const pieces = pieceEls.map(el => {
    const obj = studies[el.dataset.obj]; scene.add(obj);
    const st = { el, obj, ry: Math.random() * 6, rx: 0, vy: .35, hover: 0, drag: null };
    el.addEventListener("pointerenter", () => { st.hover = 1; kick(); });
    el.addEventListener("pointerleave", () => { st.hover = 0; });
    el.addEventListener("pointerdown", e => {
      el.setPointerCapture(e.pointerId);
      st.drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0 }; kick();
    });
    el.addEventListener("pointermove", e => {
      if (!st.drag) return;
      const dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y, now = performance.now(), dtm = Math.max(8, now - st.drag.t) / 1000;
      st.ry += dx * .012; st.rx = clamp(st.rx + dy * .008, -.8, .8);
      st.drag.vx = dx * .012 / dtm; st.drag.x = e.clientX; st.drag.y = e.clientY; st.drag.t = now;
    });
    const up = () => { if (!st.drag) return; st.vy = clamp(st.drag.vx, -14, 14); st.drag = null; };   // keep the flick's spin
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    return st;
  });
  function syncPieces(dt) {
    let any = false;
    pieces.forEach(p => {
      const r = p.el.getBoundingClientRect(), vis = r.bottom > 0 && r.top < H;
      p.obj.visible = vis; if (!vis) return; any = true;
      const idle = reduced ? 0 : .35 + p.hover * .9;
      if (!p.drag) { p.vy += (idle - p.vy) * Math.min(1, dt * 1.6); p.ry += p.vy * dt; p.rx *= Math.pow(.15, dt); }
      const s = Math.min(r.width, r.height) * .36 * (1 + p.hover * .06);
      p.obj.scale.setScalar(s);
      p.obj.position.set(r.left + r.width / 2 - W / 2, H / 2 - (r.top + r.height * .46), 0);
      p.obj.rotation.set(p.rx + .25, p.ry, 0);
    });
    return any;
  }

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
    const strip = $(".strip"), live = heroOn || onScreen(archiveTitle, 200) || onScreen(strip, 100) || onScreen(foot, 200) || anyGlint;
    if (!live) { renderer.clear(); return; }

    tilt += (tiltTarget() - tilt) * Math.min(1, dt * 4);
    let any = false; typeItems.forEach(it => { if (syncType(it, W, H)) any = true; });

    syncPieces(dt);

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

      const ss = narrow ? 52 : clamp(hr.width * .06, 56, 100);
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
