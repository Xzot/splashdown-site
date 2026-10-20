// SplashDown park map: a painted miniature of the real park (positions from the county's 2024 park
// map), driven by the height ruler. Set a height and the rides that fit light up; scroll the tour and
// the camera flies ride to ride; pick a pavilion and the booking request carries its name.
// The tour is plain HTML (articles with photos and facts), so without WebGL, or with reduced motion
// asking for no flights, the page still reads as a complete, accessible list. Built with the
// threejs-* skills (scene-builder, lighting, shadows, materials, shaders, performance).
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const section = document.querySelector("[data-map]");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- the park, traced from above
// Positions are traced from satellite imagery of the park (Google Maps, 1530 px wide, north up) and
// named from the legend of the county's 2024 park map. Image pixels to world units: x east, z south,
// one unit is about two metres.
const P = (sx, sy, y = 0) => new THREE.Vector3((sx - 560) * 0.16, y, (sy - 640) * 0.16);

const PLACES = [
  // rides and pools (min/max: height rule in inches)
  { id: "tower", name: "Pipeline Tower", kind: "ride", at: P(505, 755), top: 10, min: 48 },
  { id: "cannonball", name: "Cannonball", kind: "ride", at: P(600, 815), top: 8, min: 48 },
  { id: "twister", name: "Tropical Twister", kind: "ride", at: P(395, 915), top: 7, min: 42 },
  { id: "kids", name: "Kids' Cove", kind: "ride", at: P(440, 545), top: 4, max: 48 },
  { id: "logwalk", name: "Log Walk", kind: "ride", at: P(360, 850), top: 2.5, minor: true },
  { id: "lily", name: "Lily Pad Crossing", kind: "ride", at: P(455, 790), top: 2, minor: true },
  { id: "lazy", name: "Lazy River", kind: "ride", at: P(788, 470), top: 2 },
  { id: "lagoon", name: "Lagoon", kind: "ride", at: P(690, 430), top: 2, minor: true },
  { id: "leisure", name: "Leisure Pool", kind: "ride", at: P(525, 915), top: 2, minor: true },
  // food
  { id: "coney", name: "Coney Island Cafe", kind: "food", at: P(830, 375), top: 4 },
  { id: "beach", name: "Beach Break", kind: "food", at: P(735, 790), top: 4 },
  { id: "surf", name: "Surf Side Express", kind: "food", at: P(340, 730), top: 4 },
  // rentals
  { id: "teal", name: "Teal Seal Pavilion", kind: "pavilion", at: P(240, 905), top: 4 },
  { id: "banana", name: "Banana Cabana Pavilion", kind: "pavilion", at: P(662, 968), top: 4 },
  { id: "kahuna", name: "Big Kahuna Tent", kind: "pavilion", at: P(170, 815), top: 6 },
  { id: "coconut", name: "Coconut Cove", kind: "pavilion", at: P(545, 470), top: 4 },
  { id: "island", name: "Island Rentals", kind: "pavilion", at: P(655, 610), top: 4 },
  { id: "coral", name: "Coral Reef Pavilion", kind: "pavilion", at: P(465, 95), top: 4 },
  { id: "shrimp", name: "Shrimp Shack Pavilion", kind: "pavilion", at: P(1260, 368), top: 4 },
  { id: "diggers", name: "Digger's Dune Pavilion", kind: "pavilion", at: P(842, 672), top: 4 },
  { id: "gate", name: "Main entrance", kind: "gate", at: P(870, 490), top: 4 },
];
const byId = Object.fromEntries(PLACES.map((p) => [p.id, p]));

// fit rules, shared by the scene, the pins and the tour copy
function fits(place, h) {
  if (place.min && h < place.min) return false;
  if (place.max && h >= place.max) return false;
  return true;
}
function fitText(place, h) {
  if (place.min && h < place.min) return `Needs ${place.min}″. ${place.min - h}″ to go.`;
  if (place.max && h >= place.max) return `For riders under ${place.max}″. Grown-ups and big kids can wade in with them.`;
  if (place.min) return `Fits at ${h}″.`;
  if (place.max) return `Fits at ${h}″.`;
  return "Any height.";
}
function nearest(place, kind) {
  let best = null, d = Infinity;
  for (const p of PLACES) {
    if (p.kind !== kind || p === place) continue;
    const dd = p.at.distanceTo(place.at);
    if (dd < d) { d = dd; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------- state shared with the page
let height = 52;
const listeners = new Set();
document.addEventListener("height:changed", (e) => {
  height = e.detail;
  listeners.forEach((fn) => fn(height));
});
function setHeight(h) {
  h = Math.max(28, Math.min(76, Math.round(h)));
  document.dispatchEvent(new CustomEvent("height:set", { detail: h }));
}

if (section) {
  bindTourCopy();
  if (webglOk()) start();
}

// The tour copy works with or without the scene: fit lines and "nearby" lines follow the height.
function bindTourCopy() {
  section.querySelectorAll("[data-fit]").forEach((el) => {
    const place = byId[el.getAttribute("data-fit")];
    const render = (h) => {
      el.textContent = fitText(place, h);
      el.classList.toggle("is-out", !fits(place, h));
    };
    listeners.add(render);
    render(height);
  });
  section.querySelectorAll("[data-near]").forEach((el) => {
    const place = byId[el.getAttribute("data-near")];
    const food = nearest(place, "food"), shade = nearest(place, "pavilion");
    el.textContent = `Nearest food: ${food.name}. Nearest shade you can rent: ${shade.name}.`;
  });
  // the hero's one-line answer: how much of the park this rider gets
  const summary = section.querySelector("[data-fit-summary]");
  if (summary) {
    const rides = PLACES.filter((p) => p.kind === "ride");
    const render = (h) => {
      const n = rides.filter((p) => fits(p, h)).length;
      summary.textContent = `${n} of ${rides.length} rides and pools fit at ${h}″.` + (h < 48 ? " The two big slides start at 48″." : "");
    };
    listeners.add(render);
    render(height);
  }
  // the height control in the tour mirrors the ticket ruler
  section.querySelectorAll("[data-height-step]").forEach((b) => {
    b.addEventListener("click", () => setHeight(height + Number(b.getAttribute("data-height-step"))));
  });
  section.querySelectorAll("[data-height-range]").forEach((r) => {
    r.addEventListener("input", () => setHeight(Number(r.value)));
    listeners.add((h) => { if (Number(r.value) !== h) r.value = String(h); });
  });
  // "where to eat": each name flies the map to that counter
  section.querySelectorAll("[data-goto]").forEach((b) => {
    b.addEventListener("click", () => document.dispatchEvent(new CustomEvent("map:focus", { detail: b.getAttribute("data-goto") })));
  });
  const outs = section.querySelectorAll("[data-height-value]");
  listeners.add((h) => outs.forEach((o) => { o.textContent = h + "″"; }));
  outs.forEach((o) => { o.textContent = height + "″"; });

  // pavilion picker: choosing one sets the booking request
  const book = section.querySelector("[data-book]");
  section.querySelectorAll("[data-pavilion]").forEach((b) => {
    b.addEventListener("click", () => choosePavilion(b.getAttribute("data-pavilion")));
  });
  function choosePavilion(id) {
    section.querySelectorAll("[data-pavilion]").forEach((o) => o.setAttribute("aria-pressed", String(o.getAttribute("data-pavilion") === id)));
    const p = byId[id];
    if (book && p) {
      const body = `Date:%0AGuests:%0APavilion: ${encodeURIComponent(p.name)}%0ACatering package:%0A`;
      book.href = `mailto:CateringInfo@pwcgov.org?subject=${encodeURIComponent("Pavilion reservation at SplashDown: " + p.name)}&body=${body}`;
      book.textContent = `Ask for ${p.name}`;
    }
    document.dispatchEvent(new CustomEvent("map:focus", { detail: id }));
  }
  section.addEventListener("map:pick", (e) => choosePavilion(e.detail));
}

function start() {
  document.documentElement.classList.add("has-map");
  const stage = section.querySelector(".map__stage");
  const canvas = section.querySelector(".map__canvas");
  const pinLayer = section.querySelector(".map__pins");
  const small = window.matchMedia("(max-width: 720px)").matches;

  // ---------------------------------------------------------------- palette
  // UI tokens from DESIGN.md for the brand parts (slides, water, roofs); the park itself is painted in
  // its real colours, as on the county's illustrated map: grass, concrete, blue umbrellas, sand.
  const css = getComputedStyle(document.documentElement);
  const token = (name) => new THREE.Color(css.getPropertyValue(name).trim());
  const DEEP = token("--bg");
  const SURFACE = token("--surface");
  const WATER = token("--field-1");
  const PAPER = token("--paper");
  const BLUE = new THREE.Color("#1F5FBF");
  const GREEN = new THREE.Color("#8DD85A");
  const TEAL = new THREE.Color("#1FA3B8");
  const GRASS = new THREE.Color("#5C9A45");
  const CONCRETE = new THREE.Color("#CFC6B6");
  const SAND = new THREE.Color("#E3CF9C");
  const WOOD = new THREE.Color("#8A6447");
  const ASPHALT = new THREE.Color("#3B4350");
  const OUT = new THREE.Color("#B9C0C9"); // a ride that does not fit at this height

  // ---------------------------------------------------------------- renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // the clear colour is not tone-mapped, so the page navy stays exact
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(DEEP);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.28;
  const camera = new THREE.PerspectiveCamera(30, 1, 2, 1200);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, GRASS, 0.45));
  const sun = new THREE.DirectionalLight(0xffeccc, 3.1);
  sun.position.set(-70, 130, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 4096, small ? 1024 : 4096);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 110, bottom: -110, near: 20, far: 360 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.25;
  sun.shadow.radius = 3;
  scene.add(sun);

  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...opts });
  const put = (mesh, pos, rotY = 0) => { mesh.position.copy(pos); mesh.rotation.y = rotY; return mesh; };
  const add = (mesh, cast = true, receive = true) => {
    mesh.castShadow = cast; mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh);
    return mesh;
  };
  const rnd = mulberry(23);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _t = new THREE.Vector3(), _e = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);

  // Surface detail without textures: patch standard materials so they keep light, shadow and the
  // environment, and add world-space noise (grass) or a joint grid (concrete) to the diffuse colour.
  const NOISE = /* glsl */ `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
  `;
  function textured(material, kind) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      const body = kind === "grass"
        ? `float g = noise(vWorldP.xz * 0.35) * 0.6 + noise(vWorldP.xz * 1.7) * 0.4;
           diffuseColor.rgb *= 0.82 + g * 0.32;
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.04, 0.8), smoothstep(0.62, 0.8, noise(vWorldP.xz * 0.12)));`
        : kind === "concrete"
        ? `vec2 j = abs(fract(vWorldP.xz / 2.0) - 0.5);
           float joint = smoothstep(0.47, 0.5, max(j.x, j.y));
           diffuseColor.rgb *= (0.95 + noise(vWorldP.xz * 2.3) * 0.07) * (1.0 - joint * 0.12);`
        : kind === "lot"
        ? `float stall = step(0.9, fract(vWorldP.x / 1.6)) * step(abs(fract(vWorldP.z / 8.0) - 0.5), 0.22);
           diffuseColor.rgb = mix(diffuseColor.rgb * (0.9 + noise(vWorldP.xz * 3.0) * 0.12), vec3(0.92), stall);`
        : `diffuseColor.rgb *= 0.94 + noise(vWorldP.xz * 4.0) * 0.1;`;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;\n" + NOISE)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + body);
    };
    return material;
  }

  // ---------------------------------------------------------------- shapes in world space
  // A THREE.Shape lives in x/y; laid flat with rotation.x = -PI/2 its y becomes world -z.
  const shapeOf = (pts) => {
    const s = new THREE.Shape();
    pts.forEach((v, i) => (i ? s.lineTo(v.x, -v.z) : s.moveTo(v.x, -v.z)));
    s.closePath();
    return s;
  };
  const pathOf = (pts) => { const p = new THREE.Path(); pts.forEach((v, i) => (i ? p.lineTo(v.x, -v.z) : p.moveTo(v.x, -v.z))); p.closePath(); return p; };
  function flat(shape, material, y, receive = true) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 32), material);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    return add(m, false, receive);
  }
  function slab(shape, material, y, depth) {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 }), material);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    return add(m, true, true);
  }
  const roundRect = (c, w, d, r = Math.min(w, d) * 0.22, angle = 0) => {
    const pts = [];
    const x0 = c.x - w / 2, x1 = c.x + w / 2, z0 = c.z - d / 2, z1 = c.z + d / 2;
    const corner = (cx, cz, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r)); } };
    corner(x1 - r, z1 - r, 0); corner(x0 + r, z1 - r, Math.PI / 2); corner(x0 + r, z0 + r, Math.PI); corner(x1 - r, z0 + r, Math.PI * 1.5);
    // the park is built at an angle to north: turn the rectangle about its centre
    return angle ? pts.map((v) => { const dx = v.x - c.x, dz = v.z - c.z; return new THREE.Vector3(c.x + dx * Math.cos(angle) - dz * Math.sin(angle), 0, c.z + dx * Math.sin(angle) + dz * Math.cos(angle)); }) : pts;
  };
  const poly = (pts) => pts.map(([x, y]) => P(x, y));
  const ellipsePts = (c, rx, rz) => Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2; return new THREE.Vector3(c.x + Math.cos(a) * rx, 0, c.z + Math.sin(a) * rz); });
  const grow = (pts, by) => { const c = pts.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(pts.length); return pts.map((v) => { const d = v.clone().sub(c); const len = d.length(); return c.clone().add(d.multiplyScalar((len + by) / len)); }); };
  function inPoly(pts, x, z) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }

  // ---------------------------------------------------------------- the plinth and the ground
  const outline = poly([[40, 520], [130, 380], [260, 250], [400, 120], [470, 55], [570, 50], [700, 110], [860, 110], [1000, 240], [1150, 310], [1300, 320], [1330, 420], [1210, 520], [1150, 700], [1000, 950], [820, 1150], [620, 1165], [420, 1115], [220, 1010], [90, 860]]);
  const grassMat = textured(mat(GRASS, { roughness: 0.95 }), "grass");
  const sideMat = mat(SURFACE, { roughness: 0.6 });
  const plinth = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(outline), { depth: 4, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 3 }), [grassMat, sideMat]);
  plinth.rotation.x = -Math.PI / 2;
  plinth.position.y = -4.5; // the bevel adds 0.5 on top: the ground sits at y = 0
  add(plinth, false, true);

  // a soft contact shadow under the plinth, so the model stands on a table instead of floating
  {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const box = new THREE.Box3().setFromPoints(outline);
    const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 1.3, size.z * 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(mid.x + 4, -5.2, mid.z + 4);
    shadow.renderOrder = -1;
    add(shadow, false, false);
  }

  // the road round the north side, and the lot by the gate
  const roadCurve = new THREE.CatmullRomCurve3(poly([[95, 610], [250, 440], [330, 300], [450, 205], [600, 175], [760, 200], [950, 300], [1080, 400], [1250, 462], [1300, 470]]), false, "centripetal");
  const asphalt = textured(mat(ASPHALT, { roughness: 0.9 }), "asphalt");
  ribbon(roadCurve, 3.2, 0.02, asphalt, 200, false);
  const LOT = poly([[700, 1070], [790, 880], [890, 650], [1000, 490], [1110, 460], [1185, 500], [1120, 690], [1000, 900], [870, 1060], [780, 1105]]);
  flat(shapeOf(LOT), textured(mat(ASPHALT, { roughness: 0.9 }), "asphalt"), 0.03);

  // the concrete deck the whole water park stands on
  // paving: the pool deck in the south-west, the island inside the lazy river, the plaza by the gate
  const DECKS = [
    poly([[215, 760], [300, 690], [325, 560], [400, 480], [500, 470], [565, 520], [565, 650], [640, 740], [720, 800], [725, 900], [645, 975], [560, 1012], [420, 1032], [300, 1010], [230, 925], [140, 880], [110, 790]]),
    poly([[640, 375], [715, 362], [752, 402], [748, 480], [722, 548], [740, 610], [722, 668], [676, 680], [630, 660], [612, 600], [616, 510], [622, 430]]),
    poly([[800, 420], [935, 425], [955, 560], [905, 650], [820, 650], [800, 560]]),
  ];
  const deckMat = textured(mat(CONCRETE, { roughness: 0.85 }), "concrete");
  DECKS.forEach((d) => flat(shapeOf(d), deckMat, 0.05));
  const inDeck = (x, z) => DECKS.some((d) => inPoly(d, x, z));

  // sand courts, tennis courts, playground
  // the two sand courts north of the road
  flat(shapeOf(roundRect(P(415, 238), 13, 17, 0.4, 0.35)), textured(mat(SAND, { roughness: 1 }), "sand"), 0.04);
  flat(shapeOf(roundRect(P(822, 152), 18, 12, 0.4, 0.5)), textured(mat(SAND, { roughness: 1 }), "sand"), 0.04);

  function ribbon(curve, width, y, material, segments = 240, closed = true) {
    const pos = [], uv = [], idx = [];
    const t = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const u = i / segments, uu = closed ? u % 1 : u;
      curve.getPointAt(uu, p); curve.getTangentAt(uu, t);
      n.crossVectors(UP, t).normalize().multiplyScalar(width / 2);
      pos.push(p.x - n.x, y, p.z - n.z, p.x + n.x, y, p.z + n.z);
      uv.push(u, 0, u, 1);
      if (i < segments) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------- water
  // Each pool gets its own copy of the water shader with its own outline, so the colour deepens away
  // from the coping, the floor tiles show through, and caustics move across it.
  const waterTime = { value: 0 };
  function waterMaterial(edge) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: waterTime, uWater: { value: WATER }, uDeep: { value: TEAL.clone().multiplyScalar(0.55) }, uSun: { value: sun.position.clone().normalize() }, uEdge: { value: edge.v }, uKind: { value: edge.kind }, uAngle: { value: edge.angle || 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uWater;
        uniform vec3 uDeep;
        uniform vec3 uSun;
        uniform vec4 uEdge;   // rect/ellipse: centre xz, half size xz
        uniform float uKind;  // 0 rect, 1 ellipse, 2 ribbon (uses uv.y)
        uniform float uAngle; // the pool's turn about its centre
        varying vec3 vWorld;
        varying vec2 vUv;
        ${NOISE}
        void main() {
          vec2 p = vWorld.xz;
          // 0 at the coping, 1 in the middle
          float depth;
          vec2 q = p - uEdge.xy;
          q = vec2(q.x * cos(uAngle) + q.y * sin(uAngle), -q.x * sin(uAngle) + q.y * cos(uAngle)) + uEdge.xy;
          if (uKind < 0.5) { vec2 d = 1.0 - abs(q - uEdge.xy) / uEdge.zw; depth = clamp(min(d.x * uEdge.z, d.y * uEdge.w) / 2.2, 0.0, 1.0); }
          else if (uKind < 1.5) { depth = clamp((1.0 - length((q - uEdge.xy) / uEdge.zw)) * 2.4, 0.0, 1.0); }
          else { depth = clamp(1.0 - abs(vUv.y - 0.5) * 2.0, 0.0, 1.0) * 1.4; }
          vec3 col = mix(uWater * 0.95, mix(uWater, uDeep, 0.7), smoothstep(0.0, 1.0, depth));

          // floor tiles seen through the water, wobbling a little
          vec2 tp = p * 1.6 + vec2(noise(p * 0.8 + uTime * 0.4), noise(p * 0.8 - uTime * 0.4)) * 0.25;
          vec2 tj = abs(fract(tp) - 0.5);
          col *= 1.0 - smoothstep(0.46, 0.5, max(tj.x, tj.y)) * 0.08 * depth;

          // caustics: thin bright ridges where two drifting noise fields cross
          float c = 1.0 - abs(noise(p * 1.4 + vec2(uTime * 0.28, 0.0)) - noise(p * 1.4 - vec2(0.0, uTime * 0.25)));
          col += pow(c, 12.0) * 0.22;

          // the sky and the sun on the surface
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(v.y, 0.0), 3.0);
          col = mix(col, vec3(0.82, 0.92, 1.0), fres * 0.18);
          vec3 n = normalize(vec3((noise(p * 2.0 + uTime) - 0.5) * 0.25, 1.0, (noise(p * 2.0 - uTime) - 0.5) * 0.25));
          col += pow(max(dot(reflect(-uSun, n), v), 0.0), 120.0) * 0.8;

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
  }

  // pools: a white coping slab with the pool cut out of it, the water just below its lip
  const copingMat = mat(new THREE.Color("#EDEAE3"), { roughness: 0.55 });
  const POOLS = [];
  function pool(kind, c, w, d, angle = 0) {
    const pts = kind === "rect" ? roundRect(c, w, d, Math.min(w, d) * 0.22, angle) : ellipsePts(c, w / 2, d / 2);
    const coping = shapeOf(grow(pts, 0.7));
    coping.holes.push(pathOf(pts));
    slab(coping, copingMat, 0.05, 0.28);
    const water = flat(shapeOf(pts), waterMaterial({ kind: kind === "rect" ? 0 : 1, v: new THREE.Vector4(c.x, c.z, w / 2, d / 2), angle }), 0.2, false);
    POOLS.push({ pts, c, w, d });
    return water;
  }
  pool("rect", P(525, 918), 25, 16, -0.42); // leisure pool, the one with lanes
  pool("rect", P(378, 862), 19, 14, -0.5);  // activity pool: log walk, twister landing
  pool("rect", P(400, 588), 22, 14, -0.55); // kids' cove
  pool("rect", P(455, 790), 9, 6, -0.45);   // lily pads
  pool("rect", P(372, 990), 8, 6, -0.42);   // plunge pool
  pool("ellipse", P(690, 432), 13, 11);     // lagoon

  // the lazy river: white banks either side of a water ribbon, two footbridges over it
  const riverCurve = new THREE.CatmullRomCurve3(
    poly([[612, 345], [700, 325], [780, 358], [792, 425], [762, 500], [746, 552], [782, 622], [772, 692], [700, 716], [620, 702], [585, 642], [590, 560], [600, 480], [592, 400]]),
    true, "centripetal"
  );
  ribbon(riverCurve, 6.6, 0.12, copingMat, 320);
  ribbon(riverCurve, 5, 0.2, waterMaterial({ kind: 2, v: new THREE.Vector4() }), 320);
  const riverPts = riverCurve.getSpacedPoints(160);
  const riverDist = (x, z) => riverPts.reduce((d, p) => Math.min(d, Math.hypot(p.x - x, p.z - z)), Infinity);
  for (const u of [0.31, 0.83]) {
    const p = riverCurve.getPointAt(u), tg = riverCurve.getTangentAt(u);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.35, 1.6), copingMat);
    bridge.position.set(p.x, 0.75, p.z);
    bridge.rotation.y = Math.atan2(tg.x, tg.z);
    add(bridge);
  }

  // ---------------------------------------------------------------- rides
  // Each ride keeps its own materials, so the height ruler can light it up or grey it out.
  const rideMats = {}; // id -> [{ material, on }]
  function rideMat(id, color, gloss = true) {
    const m = gloss && !small
      ? new THREE.MeshPhysicalMaterial({ color: color.clone(), roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, emissive: color.clone(), emissiveIntensity: 0.06 })
      : mat(color.clone(), { roughness: 0.35, emissive: color.clone(), emissiveIntensity: 0.06 });
    (rideMats[id] = rideMats[id] || []).push({ material: m, on: color.clone() });
    return m;
  }
  const steelMat = mat(new THREE.Color("#EEF1F4"), { roughness: 0.4, metalness: 0.3 });
  const frameMat = mat(new THREE.Color("#D7DCE2"), { roughness: 0.5, metalness: 0.2 });

  function spiral(center, turns, radius, height, phase, wobble = 0.3, base = 0.5) {
    const pts = [];
    const steps = Math.round(turns * 18);
    for (let i = 0; i <= steps; i++) {
      const k = i / steps, a = phase + k * turns * Math.PI * 2;
      const r = radius + Math.sin(k * Math.PI * 3) * wobble;
      pts.push(new THREE.Vector3(center.x + Math.cos(a) * r, base + height * (1 - k), center.z + Math.sin(a) * r));
    }
    return pts;
  }
  // a slide tube with thin steel legs down to the deck every few metres
  function slide(pts, r, material, seg = 180) {
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 14, false), material));
    const legs = Math.floor(curve.getLength() / 3.2);
    const leg = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 6), frameMat, legs);
    for (let i = 0; i < legs; i++) {
      const p = curve.getPointAt((i + 0.5) / legs);
      const hgt = Math.max(0.1, p.y - r);
      leg.setMatrixAt(i, _m.compose(_t.set(p.x, hgt / 2, p.z), _q.identity(), _s.set(1, hgt, 1)));
    }
    leg.castShadow = true;
    scene.add(leg);
  }
  // an open steel tower: four posts, a landing every storey, a roof
  function tower(at, h, w, roofColor, levels = 4) {
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, h + 1.6, 8), steelMat), at.clone().add(new THREE.Vector3(dx * w / 2, (h + 1.6) / 2, dz * w / 2))));
    for (let i = 1; i <= levels; i++) add(put(new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.14, w + 0.4), frameMat), at.clone().setY((h * i) / levels)));
    // the stair: a ribbon of steps winding up one side
    const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.08, 0.34), frameMat, levels * 8);
    for (let i = 0; i < levels * 8; i++) {
      const k = i / (levels * 8), side = Math.floor(i / 8) % 2 ? 1 : -1;
      steps.setMatrixAt(i, _m.makeTranslation(at.x + w / 2 + 0.55, h * k, at.z + side * (((i % 8) / 8) - 0.5) * w));
    }
    steps.castShadow = true;
    scene.add(steps);
    add(put(new THREE.Mesh(new THREE.ConeGeometry(w * 0.95, 1.2, 4), mat(roofColor, { roughness: 0.5 })), at.clone().setY(h + 2.2), Math.PI / 4));
  }

  // Pipeline Tower: two enclosed tubes, blue and teal, round a four-storey tower
  {
    const at = byId.tower.at;
    tower(at, 8.6, 2.2, BLUE, 4);
    // two enclosed tubes winding round each other: same turns, half a turn apart, one wider
    slide(spiral(at, 2.25, 3.0, 8.4, 0, 0.35), 0.52, rideMat("tower", BLUE));
    slide(spiral(at, 2.25, 3.9, 7.9, Math.PI, 0.35), 0.52, rideMat("tower", TEAL));
  }
  // Cannonball: two short steep drops into their own run-out pool
  {
    const top = byId.cannonball.at.clone().add(new THREE.Vector3(-3.4, 0, -3.4));
    tower(top, 6.2, 1.8, GREEN, 3);
    const land = P(585, 885, 0.6); // into the east end of the leisure pool
    for (const dx of [-0.75, 0.75]) {
      const o = new THREE.Vector3(dx, 0, 0);
      slide([top.clone().setY(6.5).add(o), top.clone().lerp(land, 0.3).setY(5.6).add(o), top.clone().lerp(land, 0.68).setY(1.9).add(o), land.clone().add(o)], 0.44, rideMat("cannonball", GREEN), 70);
    }
  }
  // Tropical Twister: open turns down into the activity pool
  {
    const at = byId.twister.at;
    tower(at.clone().add(new THREE.Vector3(-2, 0, -1.4)), 5.4, 1.6, TEAL, 3);
    slide(spiral(at, 1.8, 2.4, 5.4, -Math.PI / 2, 0.2), 0.48, rideMat("twister", WATER));
  }
  // Kids' Cove: a play fort with a bucket on top and four small slides
  {
    const at = byId.kids.at;
    add(put(new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.3, 3.8), rideMat("kids", GREEN)), at.clone().setY(2)));
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.6, 8), rideMat("kids", GREEN)), at.clone().add(new THREE.Vector3(dx * 1.7, 1.8, dz * 1.7))));
    add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 1, 16), rideMat("kids", BLUE)), at.clone().setY(4.1)));
    add(put(new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.3, 4), mat(new THREE.Color("#F2C230"), { roughness: 0.5 })), at.clone().setY(3.3), Math.PI / 4));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      slide([at.clone().addScaledVector(d, 1.9).setY(2.1), at.clone().addScaledVector(d, 3.4).setY(1.2), at.clone().addScaledVector(d, 4.8).setY(0.45)], 0.3, rideMat("kids", i % 2 ? BLUE : WATER), 30);
    }
    const toPool = P(400, 588).sub(at).setY(0).normalize(), side = new THREE.Vector3(-toPool.z, 0, toPool.x);
    for (const [color, s] of [[new THREE.Color("#E94F87"), 1], [new THREE.Color("#F28C28"), -1]]) {
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        pts.push(at.clone().addScaledVector(toPool, 1.6 + t * 7.5).addScaledVector(side, s * (1.2 + Math.sin(t * Math.PI * 1.5) * 2.2)).setY(3.8 - t * 3.3));
      }
      slide(pts, 0.36, rideMat("kids", color), 60);
    }
  }
  // Log Walk: floating logs across the activity pool under a cargo net line
  {
    const at = byId.logwalk.at;
    const logMat = rideMat("logwalk", new THREE.Color("#C98B4E"), false);
    for (let i = 0; i < 6; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 2.4, 12), logMat);
      log.position.set(at.x - 3 + i * 1.2, 0.32, at.z + 1.5);
      log.rotation.x = Math.PI / 2;
      add(log);
    }
    for (const dx of [-3.9, 3.9]) add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), steelMat), new THREE.Vector3(at.x + dx, 1.8, at.z + 1.5)));
    const net = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.06, 2.2), rideMat("logwalk", new THREE.Color("#F2C230"), false));
    net.position.set(at.x, 3.3, at.z + 1.5);
    add(net);
  }
  // Lily Pad Crossing
  {
    const at = byId.lily.at;
    const padMat = rideMat("lily", GREEN, false);
    for (let i = 0; i < 6; i++) add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.14, 18), padMat), new THREE.Vector3(at.x - 1.6 + (i % 3) * 1.6, 0.26, at.z - 1 + Math.floor(i / 3) * 2)));
  }

  // ---------------------------------------------------------------- buildings: food, pavilions, gate
  const wallMat = mat(new THREE.Color("#F6F3EE"), { roughness: 0.7 });
  const roofWood = WOOD.clone();
  function building(place) {
    const at = place.at;
    if (place.kind === "food" || place.kind === "gate") {
      const w = place.kind === "gate" ? 9 : 4.6, d = place.kind === "gate" ? 22 : 3.2;
      add(put(new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), wallMat), at.clone().setY(1.2)));
      add(put(new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.28, d + 0.8), rideMat(place.id, place.kind === "food" ? TEAL : BLUE, false)), at.clone().setY(2.6)));
      // a striped awning over the counter
      add(put(new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.08, 1.2), mat(new THREE.Color("#F2C230"), { roughness: 0.6 })), at.clone().add(new THREE.Vector3(0, 1.9, d / 2 + 0.55))));
    } else if (place.id === "kahuna") {
      // the big striped tent from the park map
      // one colour per triangle, alternating round the cone, so the stripes stay crisp
      const g = new THREE.ConeGeometry(5.8, 3.6, 16, 1).toNonIndexed();
      const colors = [];
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i += 3) {
        const cx = pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2), cz = pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2);
        const stripe = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 16) % 2;
        const c = stripe ? BLUE : new THREE.Color("#F6F3EE");
        for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      const tent = new THREE.Mesh(g, rideMat(place.id, new THREE.Color(1, 1, 1), false));
      tent.material.vertexColors = true;
      add(put(tent, at.clone().setY(3.4)));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 6), steelMat), at.clone().add(new THREE.Vector3(Math.cos(a) * 5.2, 0.9, Math.sin(a) * 5.2)))); }
      flat(shapeOf(roundRect(at, 11, 11, 4)), textured(mat(CONCRETE), "concrete"), 0.04);
    } else {
      // open pavilion: a slab, four timber posts, a pyramid roof, picnic tables
      flat(shapeOf(roundRect(at, 6, 5, 0.4)), textured(mat(CONCRETE), "concrete"), 0.06);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(put(new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.3, 0.22), mat(WOOD)), at.clone().add(new THREE.Vector3(dx * 2.3, 1.15, dz * 1.8))));
      add(put(new THREE.Mesh(new THREE.ConeGeometry(4.2, 1.7, 4), rideMat(place.id, roofWood, false)), at.clone().setY(3.1), Math.PI / 4));
      for (const dz of [-0.8, 0.8]) add(put(new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.9), mat(WOOD)), at.clone().add(new THREE.Vector3(0, 0.75, dz))));
    }
  }
  PLACES.filter((p) => p.kind !== "ride").forEach(building);
  // buildings on the satellite view that the park map does not name: the bathhouse, the restroom
  for (const [x, y, w, d, a] of [[290, 822, 7, 17, 0.5], [575, 338, 8, 6, 0.4]]) {
    add(put(new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, d), wallMat), P(x, y, 1.3), a));
    add(put(new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.3, d + 0.7), mat(new THREE.Color("#5A5F6B"), { roughness: 0.7 })), P(x, y, 2.75), a));
  }

  // spots taken by rides, buildings and anything placed later (umbrellas keep clear of them)
  const occupied = PLACES.map((p) => ({ at: p.at, r: p.kind === "ride" ? (p.id === "tower" ? 6.5 : 4.5) : 3.6 }));
  // rental cabanas: the blue tents along the river and the leisure pool
  {
    const spots = [[838, 728], [826, 752], [742, 792], [716, 852], [482, 1000], [515, 1022], [548, 1004], [610, 640]];
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), wallMat, spots.length);
    const roof = new THREE.InstancedMesh(new THREE.ConeGeometry(2.1, 0.9, 4), mat(BLUE, { roughness: 0.5 }), spots.length);
    spots.forEach(([x, y], i) => {
      const p = P(x, y);
      base.setMatrixAt(i, _m.compose(_t.set(p.x, 0.8, p.z), _q.setFromAxisAngle(UP, 0.4), _s.set(1, 1, 1)));
      roof.setMatrixAt(i, _m.compose(_t.set(p.x, 2.05, p.z), _q.setFromAxisAngle(UP, 0.4 + Math.PI / 4), _s.set(1, 1, 1)));
      occupied.push({ at: p, r: 2.2 });
    });
    [base, roof].forEach((im) => { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; scene.add(im); });
  }
  // footpaths: from the gate plaza round the south of the river, and from the pool deck to the restroom
  for (const pts of [[[820, 640], [770, 735], [700, 772], [640, 760]], [[470, 482], [540, 430], [575, 380]]]) {
    ribbon(new THREE.CatmullRomCurve3(poly(pts), false, "centripetal"), 2.6, 0.045, deckMat, 60, false);
  }

  // ---------------------------------------------------------------- life on the deck
  // Spots on the concrete, clear of water and of every structure. One InstancedMesh per kind.
  const grownPools = {};
  const inPool = (x, z, margin) => (grownPools[margin] = grownPools[margin] || POOLS.map((p) => grow(p.pts, margin))).some((pts) => inPoly(pts, x, z));
  function spot(margin = 1.2) {
    for (let tries = 0; tries < 60; tries++) {
      const x = -75 + rnd() * 140, z = -50 + rnd() * 115;
      if (!inDeck(x, z) || inPool(x, z, margin) || riverDist(x, z) < 3.4 + margin) continue;
      if (occupied.some((o) => Math.hypot(o.at.x - x, o.at.z - z) < o.r)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  }
  const count = (n) => Math.round(n * (small ? 0.55 : 1));

  // blue umbrellas, the park's signature, with loungers under and around them
  const umbrellaSpots = Array.from({ length: count(70) }, () => spot(1.6)).filter(Boolean);
  umbrellaSpots.forEach((p) => occupied.push({ at: p, r: 1.4 }));
  const canopies = new THREE.InstancedMesh(new THREE.ConeGeometry(1.25, 0.5, 10, 1, true), mat(new THREE.Color(1, 1, 1), { side: THREE.DoubleSide, roughness: 0.6 }), umbrellaSpots.length);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), steelMat, umbrellaSpots.length);
  const canopyTones = [BLUE, BLUE, BLUE, new THREE.Color("#2A73D6"), TEAL];
  umbrellaSpots.forEach((p, i) => {
    poles.setMatrixAt(i, _m.makeTranslation(p.x, 1.15, p.z));
    canopies.setMatrixAt(i, _m.compose(_t.set(p.x, 2.45, p.z), _q.setFromEuler(_e.set(0, rnd() * Math.PI, 0)), _s.set(1, 1, 1)));
    canopies.setColorAt(i, canopyTones[Math.floor(rnd() * canopyTones.length)]);
  });
  const loungerSpots = [];
  umbrellaSpots.forEach((p) => { for (let k = 0; k < 2; k++) loungerSpots.push([p.x + (k ? 0.9 : -0.9), p.z + 0.4, 0]); });
  for (let i = 0; i < count(40); i++) { const p = spot(0.9); if (p) loungerSpots.push([p.x, p.z, rnd() * Math.PI]); }
  const loungers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.22, 1.7), mat(new THREE.Color("#FAFAF7"), { roughness: 0.5 }), loungerSpots.length);
  loungerSpots.forEach(([x, z, r], i) => loungers.setMatrixAt(i, _m.compose(_t.set(x, 0.2, z), _q.setFromEuler(_e.set(0, r, 0)), _s.set(1, 1, 1))));

  // people: on the deck standing, in the water up to the shoulders
  const suits = ["#E4572E", "#F2C230", "#1F5FBF", "#FFFFFF", "#8DD85A", "#E94F87", "#2EC4E6", "#1B1B2F"].map((c) => new THREE.Color(c));
  const skins = ["#F1C9A5", "#D9A27B", "#A86B48", "#6E4530"].map((c) => new THREE.Color(c));
  const people = [];
  for (let i = 0; i < count(150); i++) { const p = spot(0.4); if (p) people.push([p, 0]); }
  POOLS.forEach((pl) => { for (let i = 0; i < Math.round(pl.w * pl.d * 0.06 * (small ? 0.55 : 1)); i++) { const x = pl.c.x + (rnd() - 0.5) * pl.w * 0.8, z = pl.c.z + (rnd() - 0.5) * pl.d * 0.8; if (inPoly(pl.pts, x, z)) people.push([new THREE.Vector3(x, 0, z), 1]); } });
  for (let i = 0; i < count(40); i++) { const p = riverCurve.getPointAt(rnd()); people.push([p.clone().add(new THREE.Vector3((rnd() - 0.5) * 2, 0, (rnd() - 0.5) * 2)), 1]); }
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.5, 3, 8), mat(new THREE.Color(1, 1, 1), { roughness: 0.6 }), people.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 10, 8), mat(new THREE.Color(1, 1, 1), { roughness: 0.7 }), people.length);
  people.forEach(([p, wet], i) => {
    const s = 0.9 + rnd() * 0.35;
    const base = wet ? -0.15 : 0.05;
    bodies.setMatrixAt(i, _m.compose(_t.set(p.x, base + 0.42 * s, p.z), _q.identity(), _s.set(s, s, s)));
    heads.setMatrixAt(i, _m.compose(_t.set(p.x, base + 0.98 * s, p.z), _q.identity(), _s.set(s, s, s)));
    bodies.setColorAt(i, suits[Math.floor(rnd() * suits.length)]);
    heads.setColorAt(i, skins[Math.floor(rnd() * skins.length)]);
  });

  // people drifting round the lazy river on inner tubes, the one thing that moves on the model
  const DRIFT = count(28);
  const drifters = Array.from({ length: DRIFT }, () => ({ u: rnd(), side: (rnd() - 0.5) * 2.6, speed: 0.004 + rnd() * 0.003, spin: rnd() * 6 }));
  const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.46, 0.2, 8, 18), mat(new THREE.Color(1, 1, 1), { roughness: 0.45 }), DRIFT);
  const floaters = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), mat(new THREE.Color(1, 1, 1), { roughness: 0.7 }), DRIFT);
  const ringTones = ["#F2C230", "#E94F87", "#2EC4E6", "#8DD85A", "#F28C28", "#1F5FBF"].map((c) => new THREE.Color(c));
  drifters.forEach((d, i) => { rings.setColorAt(i, ringTones[i % ringTones.length]); floaters.setColorAt(i, skins[i % skins.length]); });
  [rings, floaters].forEach((im) => { im.castShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.instanceColor.needsUpdate = true; scene.add(im); });
  const _rp = new THREE.Vector3(), _rt = new THREE.Vector3(), _rn = new THREE.Vector3(), _flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  function drift(time) {
    drifters.forEach((d, i) => {
      const u = (d.u + time * d.speed) % 1;
      riverCurve.getPointAt(u, _rp); riverCurve.getTangentAt(u, _rt);
      _rn.crossVectors(UP, _rt).normalize();
      _rp.addScaledVector(_rn, d.side);
      _q.setFromAxisAngle(UP, d.spin + time * 0.2).multiply(_flat);
      rings.setMatrixAt(i, _m.compose(_t.set(_rp.x, 0.26, _rp.z), _q, _s.set(1, 1, 1)));
      floaters.setMatrixAt(i, _m.compose(_t.set(_rp.x, 0.62, _rp.z), _q.identity(), _s.set(1, 1, 1)));
    });
    rings.instanceMatrix.needsUpdate = true;
    floaters.instanceMatrix.needsUpdate = true;
  }
  drift(0);

  // ---------------------------------------------------------------- trees, fence, cars
  const treeSpots = [];
  const inner = grow(outline, -2.5), deckZones = DECKS.map((d) => grow(d, 2.5)), lotZone = grow(LOT, 2), roadPts = roadCurve.getSpacedPoints(120);
  for (let i = 0; treeSpots.length < (small ? 150 : 280) && i < 6000; i++) {
    const x = -90 + rnd() * 220, z = -95 + rnd() * 185;
    if (!inPoly(inner, x, z) || deckZones.some((d) => inPoly(d, x, z)) || riverDist(x, z) < 5) continue;
    if (inPoly(lotZone, x, z) || roadPts.some((p) => Math.hypot(p.x - x, p.z - z) < 3.6)) continue;
    if (occupied.some((o) => Math.hypot(o.at.x - x, o.at.z - z) < o.r + 2.5)) continue;
    if (treeSpots.some(([t]) => Math.hypot(t.x - x, t.z - z) < 2.2)) continue;
    treeSpots.push([new THREE.Vector3(x, 0, z), 0.75 + rnd() * 0.7, rnd() < 0.28]);
  }
  const leafTones = ["#3E7D3A", "#4F8F3F", "#5FA34A", "#6FAE4E", "#3B6E45"].map((c) => new THREE.Color(c));
  const broad = treeSpots.filter((t) => !t[2]), pines = treeSpots.filter((t) => t[2]);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat(new THREE.Color(1, 1, 1), { roughness: 0.9, flatShading: true }), broad.length * 3);
  broad.forEach(([p, k], i) => {
    for (let j = 0; j < 3; j++) {
      const a = j * 2.1 + i, off = j ? 0.55 * k : 0;
      crowns.setMatrixAt(i * 3 + j, _m.compose(_t.set(p.x + Math.cos(a) * off, (2.3 + (j ? 0 : 0.5)) * k, p.z + Math.sin(a) * off), _q.identity(), _s.setScalar((j ? 1.05 : 1.35) * k)));
      crowns.setColorAt(i * 3 + j, leafTones[(i + j) % leafTones.length]);
    }
  });
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(1.1, 3.4, 8), mat(new THREE.Color("#2F5E3A"), { roughness: 0.9, flatShading: true }), pines.length);
  pines.forEach(([p, k], i) => cones.setMatrixAt(i, _m.compose(_t.set(p.x, 2.2 * k, p.z), _q.identity(), _s.setScalar(k))));
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6), mat(WOOD), treeSpots.length);
  treeSpots.forEach(([p, k], i) => trunks.setMatrixAt(i, _m.compose(_t.set(p.x, 0.8 * k, p.z), _q.identity(), _s.setScalar(k))));

  const fenceCurve = new THREE.CatmullRomCurve3(grow(outline, -1.2), true, "catmullrom", 0.1);
  const fenceN = Math.floor(fenceCurve.getLength() / 1.4);
  const fence = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), mat(WOOD), fenceN);
  for (let i = 0; i < fenceN; i++) { const p = fenceCurve.getPointAt(i / fenceN); fence.setMatrixAt(i, _m.makeTranslation(p.x, 0.45, p.z)); }

  const carTones = ["#E4572E", "#F6F3EE", "#1F5FBF", "#2B2F36", "#B8BEC6", "#F2C230", "#7A8794"].map((c) => new THREE.Color(c));
  const carSpots = [];
  const lotC = P(950, 790), along = P(1000, 470).sub(P(760, 900)).normalize(), across = new THREE.Vector3(-along.z, 0, along.x);
  const lotInner = grow(LOT, -1.5), carTurn = Math.atan2(across.x, across.z);
  for (let row = -12; row <= 12; row++) {
    if (((row % 3) + 3) % 3 === 2) continue; // every third row is the driving aisle
    for (let k = -70; k <= 70; k++) {
      const p = lotC.clone().addScaledVector(across, row * 2.4).addScaledVector(along, k * 1.05);
      if (inPoly(lotInner, p.x, p.z) && inPoly(inner, p.x, p.z) && rnd() < 0.42) carSpots.push(p);
    }
  }
  const cars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.5, 1.5), mat(new THREE.Color(1, 1, 1), { roughness: 0.3, metalness: 0.4 }), carSpots.length);
  const cabins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.66, 0.36, 0.8), mat(new THREE.Color("#26303C"), { roughness: 0.15, metalness: 0.6 }), carSpots.length);
  carSpots.forEach((p, i) => {
    _q.setFromAxisAngle(UP, carTurn);
    cars.setMatrixAt(i, _m.compose(_t.set(p.x, 0.33, p.z), _q, _s.set(1, 1, 1)));
    cabins.setMatrixAt(i, _m.compose(_t.set(p.x, 0.74, p.z), _q, _s.set(1, 1, 1)));
    cars.setColorAt(i, carTones[Math.floor(rnd() * carTones.length)]);
  });

  [canopies, poles, loungers, bodies, heads, crowns, cones, trunks, fence, cars, cabins].forEach((im) => {
    im.castShadow = true; im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
  });

  // ---------------------------------------------------------------- pins: real buttons over the model
  const pins = PLACES.filter((p) => p.kind !== "gate").map((place) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `pin pin--${place.kind}`;
    b.textContent = place.name;
    b.setAttribute("data-place", place.id);
    b.addEventListener("click", () => {
      if (place.kind === "pavilion") { section.dispatchEvent(new CustomEvent("map:pick", { detail: place.id })); return; }
      if (place.kind === "food") { document.dispatchEvent(new CustomEvent("map:focus", { detail: place.id })); return; }
      const step = section.querySelector(`[data-stop][data-focus~="${place.id}"]`);
      if (step) step.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    });
    pinLayer.appendChild(b);
    return { place, el: b, v: new THREE.Vector3() };
  });

  // ---------------------------------------------------------------- the tour: steps set the shot
  const steps = [...section.querySelectorAll("[data-stop]")];
  const shot = { from: new THREE.Vector3(), to: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3(), t: 1 };
  const look = new THREE.Vector3();
  let current = null, focusId = null, showKinds = ["ride"], focusIds = [];

  function shotFor(ids, distance, az = 0.32, el = 0.62) {
    const target = new THREE.Vector3();
    ids.forEach((id) => target.add(byId[id].at));
    // aim a third of the way up a single ride, so its pin stays in frame
    target.divideScalar(ids.length).setY(ids.length === 1 ? Math.max(1.5, byId[ids[0]].top * 0.4) : 1.5);
    const pos = target.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(distance));
    return { pos, target };
  }
  function fly(ids, distance, az, el) {
    // phones: the tour card covers the lower half; wide, short windows need the wide shots pulled back
    const wide = ids.length > 1 ? Math.max(1, camera.aspect / 1.4) : 1;
    const s = shotFor(ids, distance * (small ? 1.35 : 1) * wide, az, el);
    shot.from.copy(camera.position); shot.fromT.copy(look);
    shot.to.copy(s.pos); shot.toT.copy(s.target);
    shot.t = reduce ? 1 : 0;
    if (reduce) { camera.position.copy(s.pos); look.copy(s.target); }
  }
  function activate(step) {
    if (step === current) return;
    current = step;
    steps.forEach((s) => s.classList.toggle("is-active", s === step));
    // the hero has its own height slider: the corner control waits for the tour
    section.classList.toggle("is-hero", step.classList.contains("stop--hero"));
    const ids = step.getAttribute("data-focus").split(" ");
    focusIds = ids;
    showKinds = (step.getAttribute("data-pins") || "ride").split(" ");
    focusId = ids.length === 1 ? ids[0] : null;
    fly(ids, Number(step.getAttribute("data-distance") || 60), Number(step.getAttribute("data-az") || 0.32), Number(step.getAttribute("data-el") || 0.62));
  }
  document.addEventListener("map:focus", (e) => {
    const p = byId[e.detail];
    if (!p) return;
    focusId = p.id;
    // a chosen pavilion takes the ride blue on its roof; the others go back to model grey
    if (p.kind === "pavilion") PLACES.filter((o) => o.kind === "pavilion").forEach((o) => (rideMats[o.id] || []).forEach((r) => { r.target = o.id === p.id ? BLUE : r.on; }));
    fly([p.id], 44, 0.4, 0.78);
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) activate(e.target); });
  }, { rootMargin: small ? "-62% 0px -30% 0px" : "-45% 0px -45% 0px" }); // phones: the cards ride low
  steps.forEach((s) => io.observe(s));

  // start on the overview
  const first = shotFor(["tower", "lagoon", "kahuna", "island"], 255, -0.5, 0.8);
  camera.position.copy(first.pos); look.copy(first.target);
  activate(steps[0]);
  shot.t = 1; camera.position.copy(shot.to); look.copy(shot.toT);

  // ---------------------------------------------------------------- height → the model
  const _c = new THREE.Color();
  function applyHeight(instant) {
    for (const [id, list] of Object.entries(rideMats)) {
      const place = byId[id];
      const on = place.kind !== "ride" || fits(place, height);
      list.forEach((r) => { r.target = on ? r.on : OUT; r.glow = on && place.kind === "ride" ? 0.06 : 0; if (instant) { r.material.color.copy(r.target); r.material.emissive.copy(r.target); r.material.emissiveIntensity = r.glow; } });
    }
    pins.forEach((p) => p.el.classList.toggle("is-out", p.place.kind === "ride" && !fits(p.place, height)));
  }
  listeners.add(() => applyHeight(false));
  applyHeight(true);

  // ---------------------------------------------------------------- sizing and the loop
  let w = 1, h = 1, offset = 0;
  function resize() {
    w = canvas.clientWidth; h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    // on wide screens the tour copy covers the left; centre the model in what is left over
    // the tour column covers the left: move the model's centre to the middle of what is left over
    const tourW = section.querySelector(".map__tour").getBoundingClientRect().width;
    offset = w > 720 ? Math.min(w * 0.3, (tourW + 24) / 2) : 0;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, -offset, small ? h * 0.16 : 0, w, h); // phones: lift the model above the tour card
    camera.updateProjectionMatrix();
    // re-take the current shot for the new frame
    if (current) { const keep = current; current = null; activate(keep); shot.t = 1; camera.position.copy(shot.to); look.copy(shot.toT); }
  }

  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  let last = performance.now(), clock = 0, sway = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    waterTime.value = clock;

    if (shot.t < 1) {
      shot.t = Math.min(1, shot.t + dt / 1.4);
      const k = ease(shot.t);
      camera.position.lerpVectors(shot.from, shot.to, k);
      // lift the camera mid-flight so long moves arc over the park instead of skimming it
      camera.position.y += Math.sin(k * Math.PI) * shot.from.distanceTo(shot.to) * 0.18;
      look.lerpVectors(shot.fromT, shot.toT, k);
    } else if (!reduce) {
      // on a single ride the camera walks slowly round it; on wide shots the model only sways
      sway += dt * 0.05;
      const r = camera.position.clone().sub(look);
      r.applyAxisAngle(UP, focusId ? dt * 0.08 : Math.sin(sway) * 0.0009);
      camera.position.copy(look).add(r);
    }
    if (!reduce) drift(clock);
    camera.lookAt(look);

    // ride colours ease toward their height state
    const lerpK = 1 - Math.exp(-dt * 6);
    for (const list of Object.values(rideMats)) {
      list.forEach((r) => {
        r.material.color.lerp(r.target, lerpK);
        r.material.emissive.lerp(_c.copy(r.target), lerpK);
        const g = r.glow + (focusId && rideMats[focusId] && rideMats[focusId].includes(r) ? 0.12 : 0);
        r.material.emissiveIntensity += (g - r.material.emissiveIntensity) * lerpK;
      });
    }

    renderer.render(scene, camera);

    // pins follow their places on screen
    pins.forEach((p) => {
      // minor places (pools, the lily pads) only get a label on their own stop
      const show = showKinds.includes(p.place.kind) && (!p.place.minor || focusIds.includes(p.place.id) || p.place.id === focusId);
      p.v.copy(p.place.at).setY(p.place.top).project(camera); // the marker sits on the place, the label above it
      const visible = show && p.v.z < 1 && Math.abs(p.v.x) < 1.05 && Math.abs(p.v.y) < 1.05;
      p.el.hidden = !visible;
      if (visible) {
        p.el.style.transform = `translate(${((p.v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - p.v.y) / 2 * h).toFixed(1)}px) translate(-50%, calc(-100% - 22px))`;
        p.el.classList.toggle("is-focus", p.place.id === focusId);
      }
    });
  }

  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { last = performance.now(); renderer.setAnimationLoop(frame); }
    else renderer.setAnimationLoop(null);
  }).observe(stage);
  window.addEventListener("resize", resize);
  resize();
  frame(performance.now());

  // the Pipeline Tower preview: loaded only when asked for
  section.querySelectorAll("[data-preview]").forEach((b) => {
    if (reduce) { b.hidden = true; return; }
    b.addEventListener("click", async () => {
      const { openPreview } = await import("./preview.js?v=20261020e");
      openPreview(b);
    });
  });
}

// small seeded random, so the trees stand in the same places on every visit
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
