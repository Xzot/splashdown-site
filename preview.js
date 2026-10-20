// SplashDown: the Pipeline Tower ride preview. Opened from the park map ("Preview the ride"), it plays
// the ride in about nine seconds: down the inside of the spiral, out of the run-out with a glance back
// at the tower, into the pool. Built with the threejs-* skills (syntax-shaders, errors-rendering,
// errors-performance). The scene is built on first open and reused; it renders only while open.
import * as THREE from "three";

let api = null;

export function openPreview(trigger) {
  if (!api) api = start(makeDialog());
  api.open(trigger);
}

function makeDialog() {
  const d = document.createElement("dialog");
  d.className = "preview";
  d.setAttribute("aria-label", "Pipeline Tower ride preview");
  d.innerHTML = `
    <canvas class="preview__canvas" aria-hidden="true"></canvas>
    <div class="preview__splash" data-splash aria-hidden="true"></div>
    <p class="preview__meter" aria-hidden="true"><span data-feet>39</span> ft to the pool</p>
    <div class="preview__bar">
      <button type="button" class="preview__b" aria-pressed="false" data-sound hidden>Sound off</button>
      <button type="button" class="preview__b" data-replay hidden>Ride again</button>
      <button type="button" class="preview__b preview__b--close" data-close>Close</button>
    </div>`;
  document.body.appendChild(d);
  return d;
}

function start(dialog) {
  const canvas = dialog.querySelector("canvas");
  const meter = dialog.querySelector("[data-feet]");
  const meterBox = meter && meter.parentElement;
  const splash = dialog.querySelector("[data-splash]");
  const replay = dialog.querySelector("[data-replay]");
  const small = window.matchMedia("(max-width: 720px)").matches;

  // ---------------------------------------------------------------- palette
  // Token colours from DESIGN.md, read from CSS so the scene follows the design system. The day
  // colours (sky, deck, grass) are mixed from those tokens, not new hues.
  const css = getComputedStyle(document.documentElement);
  const token = (name) => new THREE.Color(css.getPropertyValue(name).trim());
  const DEEP = token("--bg");
  const SURFACE = token("--surface");
  const WATER = token("--field-1");
  const PAPER = token("--paper");
  const BLUE = new THREE.Color("#1F5FBF");  // umbrella blue, ride tone in DESIGN.md
  const GREEN = new THREE.Color("#8DD85A"); // lily-pad green, ride tone in DESIGN.md
  const TEAL = WATER.clone().multiplyScalar(0.72);
  const ZENITH = BLUE.clone().lerp(WATER, 0.35);
  const HORIZON = PAPER.clone().lerp(WATER, 0.25);
  const GRASS = GREEN.clone().multiplyScalar(0.42);
  const UNDER = WATER.clone().multiplyScalar(0.55);

  // ---------------------------------------------------------------- renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(HORIZON);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 45, 170);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 260);

  scene.add(new THREE.HemisphereLight(ZENITH.clone().lerp(new THREE.Color(1, 1, 1), 0.5), GRASS, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(10, 22, 4);
  scene.add(sun);
  const SUN_DIR = sun.position.clone().normalize();

  // ---------------------------------------------------------------- the slides
  // Four stories is about 12 m. Three and a half turns, then a straight run-out that leaves the
  // rider just above the pool.
  const HEIGHT = 12, R = 4.2, TURNS = 3.5, POOL = -1.45, RADIUS = 0.62;

  function spiral(turns, radius, height, phase, wobble) {
    const pts = [];
    const steps = Math.round(turns * 18);
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const a = phase + k * turns * Math.PI * 2;
      const r = radius + Math.sin(k * Math.PI * 3) * wobble; // the spiral breathes so it never reads as a loop
      pts.push(new THREE.Vector3(Math.cos(a) * r, height * (1 - k), Math.sin(a) * r));
    }
    return pts;
  }
  function runOut(pts, angle) {
    const end = pts[pts.length - 1];
    const dir = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    pts.push(end.clone().addScaledVector(dir, 4).setY(-0.4), end.clone().addScaledVector(dir, 8).setY(-0.85));
    return pts;
  }

  const curve = new THREE.CatmullRomCurve3(runOut(spiral(TURNS, R, HEIGHT, 0, 0.8), TURNS * Math.PI * 2), false, "centripetal");
  const LENGTH = curve.getLength();
  const EXIT = curve.getPointAt(1);
  const EXIT_DIR = curve.getTangentAt(1).setY(0).normalize();
  // the second slide, seen only from outside: the other way round, wider, a story lower
  const curve2 = new THREE.CatmullRomCurve3(runOut(spiral(2.5, R + 2.1, HEIGHT - 2.5, Math.PI, 0.5), Math.PI * 6), false, "centripetal");

  // ---------------------------------------------------------------- shaders
  const NOISE = /* glsl */ `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
  `;

  const shared = {
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uDeep: { value: DEEP },
    uHaze: { value: HORIZON },
    uZenith: { value: ZENITH },
    uSeam: { value: SURFACE },
    uWater: { value: WATER },
    uSun: { value: SUN_DIR },
    uRingAt: { value: new THREE.Vector2() },
    uRing: { value: 0 },
  };

  // One material, both faces. The outside (front faces) is a lit moulded tube; the inside (back
  // faces) is daylight through the plastic, seam rings and a film of water running along the floor.
  // Geometry normals point outward, so inside the tube the floor is where the normal points down.
  function tubeMaterial(color, length) {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { ...shared, uWall: { value: color }, uSections: { value: Math.round(length / 1.6) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        varying float vDepth;
        void main() {
          vUv = uv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vec4 mv = viewMatrix * w;
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uFlow;
        uniform vec3 uWall;
        uniform vec3 uSeam;
        uniform vec3 uWater;
        uniform vec3 uDeep;
        uniform vec3 uHaze;
        uniform vec3 uZenith;
        uniform vec3 uSun;
        uniform float uSections;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        varying float vDepth;
        ${NOISE}

        void main() {
          vec3 n = normalize(vNormalW);
          float s = fract(vUv.x * uSections);
          float section = mod(floor(vUv.x * uSections), 2.0);
          float seam = smoothstep(0.0, 0.02, s) * smoothstep(0.06, 0.035, s);
          vec3 col;

          if (gl_FrontFacing) {
            // outside: a lit moulded tube, sky on its back, a hard highlight along the top
            float diff = max(dot(n, uSun), 0.0);
            vec3 v = normalize(cameraPosition - vWorld);
            float spec = pow(max(dot(reflect(-uSun, n), v), 0.0), 36.0);
            float skyLight = 0.5 + 0.5 * n.y;
            col = uWall * (0.28 + 0.75 * diff) + uZenith * skyLight * 0.12 + spec * 0.45;
            col = mix(col, uSeam, seam * 0.55);
            col = mix(col, uHaze, smoothstep(45.0, 170.0, vDepth));
          } else {
            // inside: the roof glows, walls fall off toward the floor
            float up = n.y;
            float sunLit = smoothstep(-0.4, 1.0, up);
            col = mix(uWall * 0.55, mix(uWall, vec3(0.8, 0.93, 1.0), 0.5), sunLit);
            col *= 0.93 + 0.07 * section;

            // patches of sun drifting across the plastic
            float patchN = noise(vec2(vUv.x * uSections * 0.35 + uTime * 0.05, vUv.y * 4.0));
            col += sunLit * smoothstep(0.55, 0.9, patchN) * 0.18;

            // seam rings between moulded sections, with a lit lip on one side
            col = mix(col, uSeam, seam * 0.85);
            col += smoothstep(0.06, 0.09, s) * smoothstep(0.13, 0.09, s) * 0.08;

            // water film on the floor, streaking downhill faster as the rider speeds up
            float floorMask = smoothstep(-0.35, -0.8, up);
            vec2 flow = vec2(vUv.x * uSections * 1.2 - uFlow * 4.0, vUv.y * 140.0);
            float streak = noise(flow) * 0.6 + noise(flow * 2.3 + 7.0) * 0.4;
            vec3 water = mix(uWater * 0.8, vec3(0.9, 0.98, 1.0), smoothstep(0.7, 0.98, streak) * 0.8);
            col = mix(col, water, floorMask * 0.85);
            col = mix(col, uDeep, smoothstep(2.0, 14.0, vDepth) * 0.75);
          }

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
  }

  const tubeMat = tubeMaterial(BLUE, LENGTH);
  const tubeMat2 = tubeMaterial(TEAL, curve2.getLength());
  const seg = small ? 0.6 : 1;
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.round(1200 * seg), RADIUS, small ? 28 : 48, false), tubeMat));
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve2, Math.round(500 * seg), RADIUS, 24, false), tubeMat2));

  // ---------------------------------------------------------------- the sky
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: shared,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHaze;
        uniform vec3 uSun;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = mix(uHaze, uZenith, smoothstep(0.0, 0.55, d.y));
          float s = max(dot(d, uSun), 0.0);
          col += vec3(1.0, 0.97, 0.9) * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.12);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // ---------------------------------------------------------------- the park: pool, deck, grass
  // The pool covers the tower and the splash zone. Deck and grass are flat shapes with holes, so
  // nothing sits over the water. (Shape y maps to world -z once the shape is laid flat.)
  const POOL_RECT = { x0: -17, x1: 17, z0: -24, z1: 12 };
  const DECK_RECT = { x0: -25, x1: 25, z0: -32, z1: 20 };
  const rectPath = (r, P) => {
    const p = new P();
    p.moveTo(r.x0, -r.z0); p.lineTo(r.x1, -r.z0); p.lineTo(r.x1, -r.z1); p.lineTo(r.x0, -r.z1); p.lineTo(r.x0, -r.z0);
    return p;
  };
  function flatWithHole(outer, hole, color, y) {
    const shape = rectPath(outer, THREE.Shape);
    shape.holes.push(rectPath(hole, THREE.Path));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    scene.add(m);
  }
  flatWithHole(DECK_RECT, POOL_RECT, PAPER.clone().multiplyScalar(0.8), POOL + 0.14);
  flatWithHole({ x0: -240, x1: 240, z0: -240, z1: 240 }, DECK_RECT, GRASS, POOL + 0.12);

  const poolMat = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uWater;
      uniform vec3 uHaze;
      uniform vec3 uZenith;
      uniform vec2 uRingAt;
      uniform float uRing;
      varying vec3 vWorld;
      varying float vDepth;
      ${NOISE}
      void main() {
        vec2 p = vWorld.xz;
        float n = noise(p * 1.1 + uTime * 0.3) * 0.5 + noise(p * 2.7 - uTime * 0.45) * 0.5;
        vec3 col = mix(uWater * 0.5, uWater * 0.88, n);

        // the sky in the water: more of it at a grazing angle
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(v.y, 0.0), 4.0);
        col = mix(col, mix(uHaze, uZenith, 0.35), fres * 0.65);

        // sun glints, sparse
        col += smoothstep(0.9, 0.99, noise(p * 6.0 + uTime * 0.8)) * 0.25;

        // rings spreading from where the rider went in
        if (uRing > 0.0) {
          float d = length(p - uRingAt);
          float front = uRing * 9.0;
          float wave = sin((d - front) * 7.0) * smoothstep(front + 0.2, front - 3.5, d) * smoothstep(front - 3.5, front, d);
          col += wave * 0.16 * (1.0 - uRing);
        }

        gl_FragColor = vec4(mix(col, uHaze, smoothstep(45.0, 170.0, vDepth)), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(POOL_RECT.x1 - POOL_RECT.x0, POOL_RECT.z1 - POOL_RECT.z0), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set((POOL_RECT.x0 + POOL_RECT.x1) / 2, POOL, (POOL_RECT.z0 + POOL_RECT.z1) / 2);
  pool.matrixAutoUpdate = false;
  pool.updateMatrix();
  scene.add(pool);

  // the tower: one column, the platform at the top, a roof on four posts
  const towerMat = new THREE.MeshLambertMaterial({ color: SURFACE });
  const parts = [];
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, HEIGHT - POOL + 1, 24), towerMat);
  column.position.y = (HEIGHT + POOL + 1) / 2;
  const platform = new THREE.Mesh(new THREE.BoxGeometry(R + 1.6, 0.25, 2.6), towerMat);
  platform.position.set((R + 1.6) / 2 - 0.2, HEIGHT - RADIUS - 0.15, -0.9);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(R + 1.6, 0.18, 2.6), new THREE.MeshLambertMaterial({ color: BLUE }));
  roof.position.set(platform.position.x, HEIGHT + 2.1, -0.9);
  parts.push(column, platform, roof);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 8), towerMat);
    post.position.set(platform.position.x + dx * ((R + 1.6) / 2 - 0.15), HEIGHT + 0.95, -0.9 + dz * 1.15);
    parts.push(post);
  }
  parts.forEach((m) => { m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); });

  // ---------------------------------------------------------------- umbrellas and people
  // InstancedMesh throughout: one draw call per kind, however many are on the deck.
  const rnd = mulberry(7);
  const deckSpots = [];
  for (let x = -21; x <= 21; x += 6) deckSpots.push([x, 16], [x, -28.5]);
  for (let z = -22; z <= 10; z += 6.5) deckSpots.push([-21.5, z], [21.5, z]);

  const umbrellas = deckSpots.filter((_, i) => i % 2 === 0);
  const canopyGeo = new THREE.ConeGeometry(1.25, 0.5, 10, 1, true);
  const canopyBlue = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: BLUE, side: THREE.DoubleSide }), umbrellas.length);
  const canopyGreen = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: GREEN, side: THREE.DoubleSide }), umbrellas.length);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), new THREE.MeshLambertMaterial({ color: PAPER }), umbrellas.length);
  const _m = new THREE.Matrix4();
  let nb = 0, ng = 0;
  umbrellas.forEach(([x, z], i) => {
    const y = POOL + 0.14;
    poles.setMatrixAt(i, _m.makeTranslation(x, y + 1.15, z));
    const canopy = i % 2 ? canopyGreen : canopyBlue;
    canopy.setMatrixAt(i % 2 ? ng++ : nb++, _m.makeTranslation(x, y + 2.45, z));
  });
  canopyBlue.count = nb; canopyGreen.count = ng;

  const bodies = [];
  deckSpots.forEach(([x, z]) => {
    const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) bodies.push([x + (rnd() - 0.5) * 3.2, POOL + 0.14, z + (rnd() - 0.5) * 2.4, 0.85 + rnd() * 0.35]);
  });
  const swimmers = [];
  for (let i = 0; i < 14; i++) {
    const x = POOL_RECT.x0 + 3 + rnd() * (POOL_RECT.x1 - POOL_RECT.x0 - 6);
    const z = POOL_RECT.z0 + 3 + rnd() * (POOL_RECT.z1 - POOL_RECT.z0 - 6);
    if (Math.hypot(x, z) < 8 || Math.hypot(x - EXIT.x, z - EXIT.z) < 6) continue; // keep clear of the tower and the splash zone
    swimmers.push([x, z]);
  }
  const personMat = new THREE.MeshLambertMaterial({ color: SURFACE });
  const torsos = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.75, 4, 8), personMat, bodies.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 10, 8), personMat, bodies.length + swimmers.length);
  const _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _t = new THREE.Vector3();
  bodies.forEach(([x, y, z, h], i) => {
    _s.set(1, h, 1);
    torsos.setMatrixAt(i, _m.compose(_t.set(x, y + 0.6 * h, z), _q.identity(), _s));
    heads.setMatrixAt(i, _m.makeTranslation(x, y + 1.25 * h + 0.12, z));
  });
  swimmers.forEach(([x, z], i) => heads.setMatrixAt(bodies.length + i, _m.makeTranslation(x, POOL + 0.06, z)));
  [canopyBlue, canopyGreen, poles, torsos, heads].forEach((im) => { im.instanceMatrix.needsUpdate = true; scene.add(im); });

  // ---------------------------------------------------------------- the splash
  const FLY = 6.5;   // metres the rider travels across the water in act C
  const HIT = 0.61;  // fraction of act C at which the rider meets the water (where arcY crosses POOL)
  const IMPACT = EXIT.clone().addScaledVector(EXIT_DIR, FLY * HIT).setY(POOL);
  shared.uRingAt.value.set(IMPACT.x, IMPACT.z);
  const DROPS = small ? 400 : 900;
  const dropGeo = new THREE.BufferGeometry();
  const dVel = new Float32Array(DROPS * 3);
  const dSize = new Float32Array(DROPS);
  for (let i = 0; i < DROPS; i++) {
    const a = rnd() * Math.PI * 2, spread = rnd();
    dVel[i * 3] = Math.cos(a) * spread * 2.6 + EXIT_DIR.x * 1.5;
    dVel[i * 3 + 1] = 2.5 + rnd() * 4.5 * (1 - spread * 0.6);
    dVel[i * 3 + 2] = Math.sin(a) * spread * 2.6 + EXIT_DIR.z * 1.5;
    dSize[i] = 0.015 + rnd() * 0.035;
  }
  dropGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DROPS * 3), 3));
  dropGeo.setAttribute("aVel", new THREE.BufferAttribute(dVel, 3));
  dropGeo.setAttribute("aSize", new THREE.BufferAttribute(dSize, 1));
  const dropMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uS: { value: 0 }, uOrigin: { value: IMPACT }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aVel;
      attribute float aSize;
      uniform float uS;
      uniform vec3 uOrigin;
      uniform float uScale;
      varying float vAlpha;
      void main() {
        float t = uS * 1.1;
        vec3 p = uOrigin + aVel * t + vec3(0.0, -6.0, 0.0) * t * t;
        p.y = max(p.y, uOrigin.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uScale / max(0.1, -mv.z);
        vAlpha = (1.0 - uS) * step(0.001, uS);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.94, 0.99, 1.0), vAlpha * smoothstep(0.5, 0.3, d));
      }
    `,
  });
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.frustumCulled = false; // positions move in the shader
  scene.add(drops);

  // ---------------------------------------------------------------- sound
  // Off until the visitor turns it on (browsers block audio before a gesture anyway). Everything is
  // synthesised with Web Audio: rushing water while riding, a splash on the way in, a splash per
  // click on the scene.
  let speed = 0;
  const sound = makeSound(dialog.querySelector("[data-sound]"), canvas, () => speed);

  // ---------------------------------------------------------------- the shot
  // Scroll fractions where each act ends.
  const A_END = 0.16, B_END = 0.86;
  const UP = new THREE.Vector3(0, 1, 0);
  const _p = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3();
  const _tan = new THREE.Vector3(), _side = new THREE.Vector3(), _down = new THREE.Vector3();
  const _a = new THREE.Vector3(), _ahead = new THREE.Vector3();
  const smooth = (x) => x * x * (3 - 2 * x);
  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  // rider pose at curve fraction t: on the floor, a little up the outer wall, banking into the turn
  function rider(t, pos, look, up) {
    curve.getPointAt(t, _a);
    curve.getTangentAt(t, _tan);
    _side.crossVectors(_tan, UP).normalize();
    _down.crossVectors(_side, _tan).normalize().negate();
    pos.copy(_a).addScaledVector(_down, RADIUS * 0.22);
    curve.getPointAt(Math.min(1, t + 0.012), look).addScaledVector(_down, RADIUS * 0.12);
    up.copy(UP).lerp(_side, 0.18).normalize();
  }

  // act A: a crane move from a wide view of the park, round behind the platform, into the mouth
  const mouth = new THREE.Vector3(), mouthLook = new THREE.Vector3(), mouthUp = new THREE.Vector3();
  rider(0, mouth, mouthLook, mouthUp);
  const behind = mouth.clone().addScaledVector(curve.getTangentAt(0), -2.6).add(new THREE.Vector3(0, 0.5, 0));
  const crane = new THREE.CatmullRomCurve3([
    new THREE.Vector3(22, 17, 19),
    new THREE.Vector3(16, 16.5, -6),
    new THREE.Vector3(6.5, 13.6, -6.5),
    behind,
    mouth,
  ], false, "centripetal");
  const towerMid = new THREE.Vector3(0, HEIGHT * 0.45, 0);

  // act C, in fractions of the act: the rider is thrown clear, glances back at the tower at the top
  // of the arc, then drops into the water at HIT (defined with the splash)
  const arcY = (c) => EXIT.y + 0.06 + 2.6 * c - 6.0 * c * c;

  let feet = -1, hit = false;
  function pose(p, shake, time) {
    let fovKick = 0;
    if (p < A_END) {
      const k = smooth(p / A_END);
      crane.getPointAt(k, _p);
      _l.copy(towerMid).lerp(mouthLook, smooth(clamp01((k - 0.45) / 0.55)));
      _u.copy(UP).lerp(mouthUp, k);
    } else if (p < B_END) {
      const t = (p - A_END) / (B_END - A_END);
      rider(t, _p, _l, _u);
      fovKick = 1;
      // a little judder, more at speed: plastic seams under the tube
      _p.addScaledVector(_side, Math.sin(time * 31) * shake * 0.6).addScaledVector(_down, Math.sin(time * 23 + 1) * shake);
    } else {
      const c = (p - B_END) / (1 - B_END);
      _p.copy(EXIT).addScaledVector(EXIT_DIR, c * FLY);
      _p.y = arcY(c);
      _ahead.copy(EXIT).addScaledVector(EXIT_DIR, c * FLY + 3);
      _ahead.y = POOL + 0.3 - c * 1.2;
      const back = Math.sin(clamp01((c - 0.12) / (HIT - 0.2)) * Math.PI); // 0 → 1 → 0, once clear of the tube
      _l.copy(_ahead).lerp(towerMid, smooth(back) * 0.9);
      _u.copy(UP);
    }
    camera.position.copy(_p);
    camera.up.copy(_u);
    camera.lookAt(_l);

    const f = Math.round(Math.min(HEIGHT, Math.max(0, _p.y)) * 3.28); // metres to feet
    if (meter && f !== feet) { feet = f; meter.textContent = String(f); }

    // the splash and the rings start when the camera reaches the water; then the frame fills with it
    const c = clamp01((p - B_END) / (1 - B_END));
    const s = clamp01((c - (HIT - 0.03)) / 0.5);
    dropMat.uniforms.uS.value = s;
    shared.uRing.value = s;
    if (s > 0 && !hit) { hit = true; sound.splash(); }
    if (s === 0) hit = false;
    const under = clamp01((POOL - _p.y) / 0.25);
    renderer.setClearColor(under > 0 ? UNDER : HORIZON);
    sky.visible = under === 0;
    if (splash) splash.style.opacity = String(under);
    if (meterBox) meterBox.style.opacity = String(1 - clamp01(c / 0.4));
    sound.ride(p > A_END && p < B_END);
    return fovKick;
  }

  // ---------------------------------------------------------------- sizing and the loop
  let baseFov = 60;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseFov = w / h < 0.8 ? 84 : 68; // portrait phones need a wider lens to feel the tube
    dropMat.uniforms.uScale.value = h * renderer.getPixelRatio() * 0.6;
  }

  // the ride runs on time, not on scroll: about six and a half seconds in the tube, two and a half
  // from the run-out to under the water
  const TUBE_S = 6.5, OUT_S = 2.5;
  let started = 0;
  function progress(now) {
    const e = Math.max(0, (now - started) / 1000); // a frame's timestamp can predate the click
    if (e < TUBE_S) return A_END + (B_END - A_END) * Math.pow(e / TUBE_S, 1.15); // gathers speed
    return Math.min(1, B_END + (1 - B_END) * (e - TUBE_S) / OUT_S);
  }

  let ride = A_END, fov = 60, lastT = performance.now(), clock = 0;
  function frame(now) {
    const dt = Math.max(0, Math.min(0.5, (now - lastT) / 1000));
    lastT = now;
    clock += Math.min(dt, 0.05);
    const before = ride;
    ride = progress(now);
    const v = dt > 0 ? Math.abs(ride - before) / dt : 0;
    speed += (v - speed) * (1 - Math.exp(-dt * 4));

    shared.uTime.value = clock;
    shared.uFlow.value += Math.min(dt, 0.05) * (1 + speed * 25);
    const kick = pose(ride, Math.min(0.02, speed * 0.05), clock);
    const targetFov = baseFov + kick * Math.min(16, speed * 50);
    fov += (targetFov - fov) * (1 - Math.exp(-dt * 5));
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
    if (ride >= 1 && replay.hidden) { replay.hidden = false; replay.focus(); }
  }

  function play() {
    replay.hidden = true;
    started = lastT = performance.now();
    ride = A_END; speed = 0;
    renderer.setAnimationLoop(frame);
  }
  replay.addEventListener("click", play);
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { renderer.setAnimationLoop(null); sound.ride(false); });
  window.addEventListener("resize", () => { if (dialog.open) resize(); });

  return {
    open() {
      dialog.showModal();
      resize();
      fov = camera.fov = baseFov;
      camera.updateProjectionMatrix();
      play();
    },
  };
}

// small seeded random, so the deck looks the same on every visit
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSound(button, canvas, getSpeed) {
  let ctx = null, on = false, noise = null, rush = null, rushGain = null, riding = false;

  function noiseBuffer(c) {
    const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    noise = noiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    rush = ctx.createBiquadFilter(); rush.type = "bandpass"; rush.frequency.value = 900; rush.Q.value = 0.7;
    rushGain = ctx.createGain(); rushGain.gain.value = 0;
    src.connect(rush).connect(rushGain).connect(ctx.destination);
    src.start();
    (function tick() {
      const s = Math.min(1, getSpeed() * 8);
      const g = on && riding ? 0.05 + s * 0.12 : 0;
      rushGain.gain.setTargetAtTime(g, ctx.currentTime, 0.15);
      rush.frequency.setTargetAtTime(700 + s * 1400, ctx.currentTime, 0.2);
      setTimeout(tick, 100);
    })();
  }
  function splash() {
    if (!on || !ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noise;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start(t); src.stop(t + 1.2);
  }
  if (button) {
    button.hidden = false;
    button.addEventListener("click", () => {
      on = !on;
      if (on && !ctx) init();
      if (ctx && ctx.state === "suspended") ctx.resume();
      button.setAttribute("aria-pressed", String(on));
      button.textContent = on ? "Sound on" : "Sound off";
      if (on) splash();
    });
    canvas.addEventListener("click", splash);
  }
  return { splash, ride(v) { riding = v; } };
}
