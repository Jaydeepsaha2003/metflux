/**
 * <wound-core-viewer> — a parametric viewer for a racetrack (obround) wound core.
 *
 * A wound core is one continuous strip of electrical steel wound spirally until
 * the radial build is reached. Two facts about that shape drive everything in
 * this file:
 *
 *   - Strip cannot make a sharp bend, and every wrap sits on a larger radius
 *     than the one beneath it. So the OUTER corner radius is always the inner
 *     radius plus the build, and the profile is a racetrack rather than a
 *     rectangle. The geometry here derives the outer profile from the inner one
 *     rather than taking it as a second input, because they are not independent.
 *
 *   - The strip is laid along the flux path the whole way round, so there is no
 *     joint and no air gap. That is the point of the product, and it is why the
 *     magnetic figures below use the MEAN path — the average of every wrap's own
 *     perimeter — rather than an inner or outer measurement.
 *
 * The maths is exported separately from the element so it can be tested without
 * a DOM or a WebGL context, and so the arithmetic on screen can be checked
 * against the same functions the drawing uses.
 *
 * Units: millimetres throughout, except density (g/cm³) and the weight it
 * produces (kg). Mixing those two is the one unit trap in the file and it is
 * handled in exactly one place — see `derive`.
 */

/* ────────────────────────────────────────────────────────────────────────────
   Pure geometry and arithmetic. No THREE, no DOM — importable anywhere.
   ──────────────────────────────────────────────────────────────────────────── */

export const DEFAULTS = Object.freeze({
  windowLength: 200,     // A — inner window length
  windowWidth: 60,       // B — inner window width
  cornerRadius: 30,      // r — inner corner radius; B/2 gives a true obround
  build: 40,             // D — radial build
  stripWidth: 60,        // H — strip width, which is the core's height
  stripThickness: 0.27,  // t
  stackingFactor: 0.96,  // SF
  density: 7.65,         // ρ, g/cm³ — 7.65 CRGO, ~8.7 nickel-iron
});

/**
 * Why a core cannot be built from these numbers, as a list of plain sentences.
 * Empty means it can.
 *
 * `cornerRadius > windowWidth / 2` is the interesting one: the corner arcs would
 * have to overlap through the middle of the window, which is not a shape. At
 * exactly half it is a true obround, which is the normal case and must pass.
 */
export function validate(p) {
  const errors = [];
  const positive = [
    ['windowLength', 'window length A'],
    ['windowWidth', 'window width B'],
    ['build', 'build D'],
    ['stripWidth', 'strip width H'],
  ];
  for (const [key, label] of positive) {
    if (!Number.isFinite(p[key]) || p[key] <= 0) errors.push(`${label} must be greater than zero`);
  }
  if (!Number.isFinite(p.stripThickness) || p.stripThickness <= 0) {
    errors.push('strip thickness t must be greater than zero');
  }
  if (!Number.isFinite(p.cornerRadius) || p.cornerRadius < 0) {
    errors.push('corner radius r cannot be negative');
  } else if (Number.isFinite(p.windowWidth) && p.cornerRadius > p.windowWidth / 2 + 1e-9) {
    errors.push(`corner radius r (${p.cornerRadius}) cannot exceed half the window width (${p.windowWidth / 2})`);
  }
  if (!Number.isFinite(p.stackingFactor) || p.stackingFactor < 0.8 || p.stackingFactor > 1) {
    errors.push('stacking factor must be between 0.8 and 1.0');
  }
  if (!Number.isFinite(p.density) || p.density <= 0) {
    errors.push('density must be greater than zero');
  }
  return errors;
}

/**
 * A closed rounded-rectangle outline as {x, y} points, counter-clockwise.
 *
 * `r = 0` gives a sharp rectangle; `r = b/2` gives an obround; `a === b` with
 * `r = a/2` gives a circle. All three fall out of the same code rather than
 * being special-cased, which is what keeps the degenerate shapes honest.
 */
export function roundedRectPoints(a, b, r, segmentsPerCorner = 16) {
  const hx = a / 2;
  const hy = b / 2;
  const rr = Math.max(0, Math.min(r, Math.min(hx, hy)));
  const cx = hx - rr;
  const cy = hy - rr;
  const pts = [];

  const arc = (ox, oy, from, to) => {
    if (rr === 0) { pts.push({ x: ox, y: oy }); return; }
    for (let i = 0; i <= segmentsPerCorner; i += 1) {
      const t = from + ((to - from) * i) / segmentsPerCorner;
      pts.push({ x: ox + rr * Math.cos(t), y: oy + rr * Math.sin(t) });
    }
  };

  const H = Math.PI / 2;
  arc(cx, -cy, -H, 0);        // bottom-right
  arc(cx, cy, 0, H);          // top-right
  arc(-cx, cy, H, 2 * H);     // top-left
  arc(-cx, -cy, 2 * H, 3 * H); // bottom-left
  return pts;
}

/** Perimeter of a closed polyline. Used by the tests to check the formula. */
export function polylinePerimeter(pts) {
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Every figure the panel shows, with the expression that produced it.
 *
 * The one unit conversion in the file lives here. Volume comes out in mm³ and
 * density is quoted in g/cm³, which is g per 1000 mm³; kilograms are therefore
 * V × ρ / 1e6, and writing it any other way is how a core comes out a thousand
 * times too heavy.
 */
export function derive(p) {
  const { windowLength: A, windowWidth: B, cornerRadius: r, build: D } = p;
  const { stripWidth: H, stripThickness: t, stackingFactor: SF, density: rho } = p;

  // Straight runs plus four quarter-circles: 2(A+B) − 8r is the straight part,
  // 2πr the corners.
  const perimeter = 2 * (A + B) - 8 * r + 2 * Math.PI * r;
  // The mean wrap sits half a build out, and offsetting a rounded rectangle by
  // d adds exactly 2πd to its perimeter — so half a build adds πD.
  const meanPath = perimeter + Math.PI * D;
  const grossArea = D * H;
  const netArea = grossArea * SF;
  const volume = netArea * meanPath;
  const weightKg = (volume * rho) / 1e6;
  const wraps = D / t;
  // Σ over wraps of each perimeter = wraps × mean perimeter, so this is exact
  // rather than an average standing in for a sum.
  const stripLength = (D * meanPath) / t;

  return {
    perimeter,
    meanPath,
    grossArea,
    netArea,
    volume,
    weightKg,
    wraps,
    stripLength,
    outerLength: A + 2 * D,
    outerWidth: B + 2 * D,
    outerHeight: H,
    outerCornerRadius: r + D,
  };
}

/** Label, value, unit and the expression, in the order the panel reads. */
export function derivedRows(p) {
  const d = derive(p);
  const f = (v, dp = 2) => v.toLocaleString('en-GB', {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
  return [
    ['Window perimeter', 'P', `${f(d.perimeter)} mm`, '2(A + B) − 8r + 2πr'],
    ['Mean magnetic path', 'Lm', `${f(d.meanPath)} mm`, 'P + πD'],
    ['Gross area', 'Ag', `${f(d.grossArea)} mm²`, 'D × H'],
    ['Net core area', 'Ae', `${f(d.netArea)} mm²`, 'Ag × SF'],
    ['Core volume', 'V', `${f(d.volume, 0)} mm³`, 'Ae × Lm'],
    ['Core weight', 'W', `${f(d.weightKg, 3)} kg`, 'V × ρ ÷ 1e6'],
    ['Wraps', 'N', f(d.wraps, 1), 'D ÷ t'],
    ['Strip length', 'L', `${f(d.stripLength / 1000, 2)} m`, 'D × Lm ÷ t'],
    ['Outside size', '', `${f(d.outerLength, 1)} × ${f(d.outerWidth, 1)} × ${f(d.outerHeight, 1)} mm`, '(A + 2D) × (B + 2D) × H'],
    ['Outer corner radius', '', `${f(d.outerCornerRadius, 1)} mm`, 'r + D'],
  ];
}

/* ────────────────────────────────────────────────────────────────────────────
   The element.
   ──────────────────────────────────────────────────────────────────────────── */

const ATTRS = {
  'window-length': 'windowLength',
  'window-width': 'windowWidth',
  'corner-radius': 'cornerRadius',
  build: 'build',
  'strip-width': 'stripWidth',
  'strip-thickness': 'stripThickness',
  'stacking-factor': 'stackingFactor',
  density: 'density',
};

/* Pinned once, here, so the demo page and the component cannot disagree about
   which three.js is loaded. An import map in the host page maps the bare
   specifiers to these, which is the modern equivalent of a pinned UMD tag:
   three stopped shipping a UMD OrbitControls after r147, so a script-tag build
   would mean either a five-year-old three or a second copy of the library on
   the page. */
export const THREE_VERSION = '0.186.0';
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

let threePromise = null;
/** Resolved once per page. Injectable for tests and offline hosts. */
function loadThree() {
  if (WoundCoreViewer.three) return Promise.resolve(WoundCoreViewer.three);
  threePromise ??= (async () => {
    const [THREE, controls] = await Promise.all([
      import(/* @vite-ignore */ 'three').catch(() => import(/* @vite-ignore */ `${CDN}/build/three.module.js`)),
      import(/* @vite-ignore */ 'three/addons/controls/OrbitControls.js')
        .catch(() => import(/* @vite-ignore */ `${CDN}/examples/jsm/controls/OrbitControls.js`)),
    ]);
    return { THREE, OrbitControls: controls.OrbitControls };
  })();
  return threePromise;
}

const CSS = `
:host { display:block; position:relative; min-height:360px; font:13px/1.45 system-ui,sans-serif; color:#0f172a; }
* { box-sizing:border-box; }
.wrap { position:absolute; inset:0; display:grid; grid-template-columns:minmax(0,1fr) 306px; }
@media (max-width:760px){ .wrap{ grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(220px,1fr) auto; } }
.stage { position:relative; min-width:0; background:radial-gradient(120% 90% at 50% 0%,#fff,#eef2f7 45%,#dde5ee); }
.stage canvas { display:block; width:100%; height:100%; }
.side { min-width:0; overflow:auto; border-left:1px solid #d7dee7; background:#fbfcfd; padding:10px 12px; }
@media (max-width:760px){ .side{ border-left:0; border-top:1px solid #d7dee7; max-height:46%; } }
h3 { margin:0 0 6px; font-size:11px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; color:#64748b; }
h3+h3 { margin-top:14px; }
.row { display:grid; grid-template-columns:52px minmax(0,1fr) 68px; align-items:center; gap:6px; margin-bottom:5px; }
.row label { font-size:11px; font-weight:700; color:#475569; }
input[type=range]{ width:100%; }
input[type=number]{ width:100%; padding:3px 5px; border:1px solid #c6d3df; background:#fff; font:inherit; font-size:12px; text-align:right; }
input[type=number]:focus{ outline:2px solid #2563eb; outline-offset:1px; }
table { width:100%; border-collapse:collapse; }
td { padding:2px 0; vertical-align:baseline; }
td.k { color:#334155; white-space:nowrap; }
td.s { width:26px; color:#64748b; font-style:italic; }
td.v { text-align:right; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
tr.f td { padding:0 0 5px; font-size:11px; color:#64748b; font-family:ui-monospace,monospace; }
.btns { display:flex; flex-wrap:wrap; gap:5px; margin:10px 0 2px; }
button { padding:5px 9px; border:1px solid #c6d3df; background:linear-gradient(#fff,#f2f6fa); font:inherit; font-size:11px; font-weight:700; cursor:pointer; }
button[aria-pressed=true]{ border-color:#1d4ed8; background:#1d4ed8; color:#fff; }
button:hover:not([aria-pressed=true]){ border-color:#8fa7bd; }
.err { position:absolute; inset:10px; display:grid; place-content:center; padding:14px; background:#fff5f5;
  border:1px solid #f0b4b4; color:#92211f; font-size:12px; }
.err ul { margin:6px 0 0; padding-left:18px; }
.err[hidden]{ display:none !important; }
`;

/* Extending HTMLElement happens when the module is EVALUATED, not when the
   element is defined, so a bare `extends HTMLElement` makes the file
   unimportable outside a browser — and the arithmetic above is exactly what is
   worth testing without one. The stand-in is never used in a browser. */
const ElementBase = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;

export class WoundCoreViewer extends ElementBase {
  /** Set to { THREE, OrbitControls } to skip the network entirely. */
  static three = null;

  static get observedAttributes() { return Object.keys(ATTRS); }

  #params = { ...DEFAULTS };
  #kit = null;             // { THREE, renderer, scene, camera, controls, ... }
  #disposables = [];
  #pending = false;
  #noEnvironment = false;
  #ro = null;
  #rafDraw = 0;
  #section = false;
  #annotate = true;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);
    root.append(this.#buildChrome());
  }

  /* ── attributes and properties, reflected both ways ───────────────────── */

  attributeChangedCallback(name, _old, value) {
    const key = ATTRS[name];
    if (!key) return;
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) this.#params[key] = n;
    else this.#params[key] = DEFAULTS[key];
    this.#syncInputs();
    this.#schedule();
  }

  connectedCallback() {
    this.#ro ??= new ResizeObserver(() => this.#resize());
    this.#ro.observe(this);
    this.#init();
  }

  disconnectedCallback() {
    this.#ro?.disconnect();
    cancelAnimationFrame(this.#rafDraw);
    this.#teardown();
  }

  get params() { return { ...this.#params }; }
  get derived() { return derive(this.#params); }

  /** Programmatic update. Reflects to attributes so the DOM stays the truth. */
  setParams(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS) || !Number.isFinite(Number(value))) continue;
      this.#params[key] = Number(value);
      const attr = Object.keys(ATTRS).find((a) => ATTRS[a] === key);
      if (attr) this.setAttribute(attr, String(value));
    }
    this.#syncInputs();
    this.#schedule();
  }

  /* ── chrome ───────────────────────────────────────────────────────────── */

  #buildChrome() {
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="stage" part="stage">
        <div class="err" hidden></div>
      </div>
      <div class="side" part="panel">
        <h3>Free variables</h3>
        <div data-free></div>
        <h3>Constraints</h3>
        <div data-fixed></div>
        <div class="btns">
          <button data-act="section" aria-pressed="false">Cross-section</button>
          <button data-act="annotate" aria-pressed="true">Dimensions</button>
          <button data-act="reset">Reset</button>
        </div>
        <h3>Derived</h3>
        <table data-out></table>
      </div>`;

    const slider = (key, label, min, max, step) => `
      <div class="row">
        <label for="s-${key}">${label}</label>
        <input id="s-${key}" type="range" data-k="${key}" min="${min}" max="${max}" step="${step}">
        <input type="number" data-k="${key}" min="${min}" step="${step}">
      </div>`;
    const number = (key, label, step) => `
      <div class="row">
        <label for="n-${key}">${label}</label>
        <span></span>
        <input id="n-${key}" type="number" data-k="${key}" step="${step}">
      </div>`;

    // D and H are what the designer actually moves, so they get sliders; the
    // window and the corner come from the coil and the winding machine.
    wrap.querySelector('[data-free]').innerHTML =
      slider('build', 'D build', 1, 200, 0.5) + slider('stripWidth', 'H strip', 1, 300, 0.5);
    wrap.querySelector('[data-fixed]').innerHTML =
      number('windowLength', 'A window', 1)
      + number('windowWidth', 'B window', 1)
      + number('cornerRadius', 'r corner', 0.5)
      + number('stripThickness', 't strip', 0.01)
      + number('stackingFactor', 'SF', 0.01)
      + number('density', 'ρ g/cm³', 0.01);

    wrap.addEventListener('input', (e) => {
      const key = e.target?.dataset?.k;
      if (!key) return;
      const v = Number.parseFloat(e.target.value);
      if (Number.isFinite(v)) this.setParams({ [key]: v });
    });
    wrap.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'reset') { this.setParams(DEFAULTS); this.#frame(false); }
      if (act === 'section') { this.#section = !this.#section; this.#applyClipping(); }
      if (act === 'annotate') { this.#annotate = !this.#annotate; this.#schedule(); }
      if (act === 'section' || act === 'annotate') {
        e.target.setAttribute('aria-pressed', String(act === 'section' ? this.#section : this.#annotate));
      }
    });
    return wrap;
  }

  #syncInputs() {
    const root = this.shadowRoot;
    if (!root) return;
    for (const input of root.querySelectorAll('input[data-k]')) {
      const v = this.#params[input.dataset.k];
      if (document.activeElement !== input && input.value !== String(v)) input.value = String(v);
    }
  }

  #renderPanel(errors) {
    const table = this.shadowRoot.querySelector('[data-out]');
    const err = this.shadowRoot.querySelector('.err');
    if (errors.length) {
      err.hidden = false;
      err.innerHTML = `<div><strong>Cannot build this core.</strong><ul>${
        errors.map((m) => `<li>${m}</li>`).join('')}</ul></div>`;
      table.innerHTML = '';
      return;
    }
    err.hidden = true;
    // The formula sits under every figure on purpose: this is a tool for
    // learning the product as much as for drawing it, so the arithmetic has to
    // be inspectable without opening the source.
    table.innerHTML = derivedRows(this.#params).map(([label, sym, value, formula]) => `
      <tr><td class="k">${label}</td><td class="s">${sym}</td><td class="v">${value}</td></tr>
      <tr class="f"><td colspan="3">${formula}</td></tr>`).join('');
  }

  /* ── three.js ─────────────────────────────────────────────────────────── */

  async #init() {
    if (this.#kit) { this.#schedule(); return; }
    const { THREE, OrbitControls } = await loadThree();
    if (!this.isConnected) return;

    const stage = this.shadowRoot.querySelector('.stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    stage.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100000);
    const controls = new OrbitControls(camera, renderer.domElement);
    /* Damping off, on purpose. Damping needs a continuous update() loop to
       animate, which fights on-demand rendering — and the pairing below is the
       one that must not be got wrong: controls.update() DISPATCHES 'change', so
       a change handler that calls update() recurses until the stack gives out.
       The handler renders and nothing else; update() is called explicitly, only
       where the camera has actually been moved by us. */
    controls.enableDamping = false;
    controls.addEventListener('change', () => this.#paint());

    // No HDR dependency: a hemisphere for the soft fill a metal surface needs
    // to read as metal at all, and one directional for the highlight.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa7b4, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1, 1.4, 0.9);
    scene.add(key);

    /* Lights alone are not enough for a metal: MeshStandardMaterial at
       metalness 0.85 reflects its surroundings and almost nothing else, so with
       no environment it renders very nearly black whatever the lamps are doing.
       RoomEnvironment is built from geometry in code rather than loaded, so this
       buys a believable brushed finish without an HDR asset. */
    try {
      const { RoomEnvironment } = await import(/* @vite-ignore */ 'three/addons/environments/RoomEnvironment.js')
        .catch(() => import(/* @vite-ignore */ `${CDN}/examples/jsm/environments/RoomEnvironment.js`));
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch {
      // No environment available: fall back to a duller, more diffuse surface
      // rather than shipping a black core.
      this.#noEnvironment = true;
    }

    this.#kit = { THREE, renderer, scene, camera, controls, body: null, dims: null, clip: null };
    this.#kit.clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.#resize();
    this.#schedule();
    this.#frame(false);
  }

  /**
   * Coalesce a rebuild onto a microtask — deliberately NOT an animation frame.
   *
   * A hidden tab does not run requestAnimationFrame, so scheduling the model
   * there meant a backgrounded page computed nothing at all: no panel, no
   * `change` event, no derived figures for a host that only wanted the numbers.
   * The arithmetic is a few dozen multiplications and owes nothing to the
   * display, so it runs on a microtask; only the WebGL draw waits on a frame,
   * and it is the one thing that genuinely should.
   */
  #schedule() {
    if (this.#pending) return;
    this.#pending = true;
    Promise.resolve().then(() => {
      this.#pending = false;
      this.#rebuild();
    });
  }

  #rebuild() {
    const errors = validate(this.#params);
    this.#renderPanel(errors);
    this.dispatchEvent(new CustomEvent('change', {
      bubbles: true,
      detail: { params: this.params, derived: errors.length ? null : this.derived, errors },
    }));
    if (!this.#kit || errors.length) return;

    const { THREE, scene } = this.#kit;
    this.#releaseMeshes();

    const p = this.#params;
    const pts = (a, b, r) => roundedRectPoints(a, b, r, 20).map((q) => new THREE.Vector2(q.x, q.y));

    const outer = new THREE.Shape(pts(p.windowLength + 2 * p.build, p.windowWidth + 2 * p.build, p.cornerRadius + p.build));
    outer.holes.push(new THREE.Path(pts(p.windowLength, p.windowWidth, p.cornerRadius)));

    const geo = new THREE.ExtrudeGeometry(outer, { depth: p.stripWidth, bevelEnabled: false });
    geo.translate(0, 0, -p.stripWidth / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb8bcc0,
      metalness: this.#noEnvironment ? 0.25 : 0.85,
      roughness: this.#noEnvironment ? 0.6 : 0.45,
    });
    const body = new THREE.Mesh(geo, mat);
    scene.add(body);
    this.#kit.body = body;
    this.#disposables.push(geo, mat);

    this.#addWraps(body);
    this.#addDimensions();
    this.#applyClipping();
    this.#frame(true);
  }

  /**
   * The wound look, as concentric outlines on the two faces.
   *
   * Modelling each wrap as its own shell would be a hundred and fifty separate
   * extrusions on a typical core — geometry nobody can see the inside of, at a
   * cost the frame rate would notice. Lines on the faces read as laminations
   * because that is exactly where a real core shows them.
   */
  #addWraps(body) {
    const { THREE } = this.#kit;
    const p = this.#params;
    const n = Math.min(40, Math.floor(p.build / p.stripThickness));
    if (n < 2) return;
    const mat = new THREE.LineBasicMaterial({ color: 0x5b6672, transparent: true, opacity: 0.32 });
    this.#disposables.push(mat);
    for (let i = 1; i < n; i += 1) {
      const d = (p.build * i) / n;
      const pts = roundedRectPoints(
        p.windowLength + 2 * d, p.windowWidth + 2 * d, p.cornerRadius + d, 20,
      );
      for (const z of [-p.stripWidth / 2, p.stripWidth / 2]) {
        const geo = new THREE.BufferGeometry().setFromPoints(
          pts.map((q) => new THREE.Vector3(q.x, q.y, z)),
        );
        const loop = new THREE.LineLoop(geo, mat);
        loop.userData.noFit = true;
        body.add(loop);
        this.#disposables.push(geo);
      }
    }
  }

  /** A, B, D and H as labelled lines, drawn off the part rather than on it. */
  #addDimensions() {
    const { THREE, scene } = this.#kit;
    if (!this.#annotate) return;
    const p = this.#params;
    const group = new THREE.Group();
    const ink = new THREE.LineBasicMaterial({ color: 0x111418 });
    this.#disposables.push(ink);

    const ox = p.windowLength / 2 + p.build;
    const oy = p.windowWidth / 2 + p.build;
    const z = p.stripWidth / 2;
    const off = Math.max(ox, oy) * 0.16;

    const span = (a, b, text) => {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      group.add(new THREE.Line(geo, ink));
      this.#disposables.push(geo);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      group.add(this.#label(text, mid, off * 0.5));
    };

    span(new THREE.Vector3(-p.windowLength / 2, 0, z), new THREE.Vector3(p.windowLength / 2, 0, z), `A ${p.windowLength}`);
    span(new THREE.Vector3(0, -p.windowWidth / 2, z), new THREE.Vector3(0, p.windowWidth / 2, z), `B ${p.windowWidth}`);
    span(new THREE.Vector3(p.windowLength / 2, -oy - off, z), new THREE.Vector3(ox, -oy - off, z), `D ${p.build}`);
    span(new THREE.Vector3(ox + off, -oy, -z), new THREE.Vector3(ox + off, -oy, z), `H ${p.stripWidth}`);

    scene.add(group);
    this.#kit.dims = group;
  }

  /** A sprite label: always square to the camera, so it stays readable. */
  #label(text, at, lift) {
    const { THREE } = this.#kit;
    const pad = 10;
    const c = document.createElement('canvas').getContext('2d');
    c.font = '600 30px system-ui, sans-serif';
    const w = Math.ceil(c.measureText(text).width) + pad * 2;
    const h = 44;
    c.canvas.width = w; c.canvas.height = h;
    c.font = '600 30px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.94)';
    c.strokeStyle = '#111418'; c.lineWidth = 2;
    c.beginPath(); c.rect(1, 1, w - 2, h - 2); c.fill(); c.stroke();
    c.fillStyle = '#111418'; c.textBaseline = 'middle';
    c.fillText(text, pad, h / 2);

    const tex = new THREE.CanvasTexture(c.canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    const scale = Math.max(this.#params.windowLength, this.#params.windowWidth) * 0.09;
    sprite.scale.set((scale * w) / h, scale, 1);
    sprite.position.copy(at);
    sprite.position.y += lift;
    sprite.renderOrder = 10;
    sprite.userData.noFit = true;
    this.#disposables.push(tex, mat);
    return sprite;
  }

  #applyClipping() {
    if (!this.#kit?.body) return;
    const { THREE, body } = this.#kit;
    // Halfway through the build, so the rectangular D x H radial section is the
    // face you end up looking at — which is the section the maths uses.
    this.#kit.clip.set(new THREE.Vector3(0, -1, 0), 0);
    body.material.clippingPlanes = this.#section ? [this.#kit.clip] : [];
    body.material.side = this.#section ? THREE.DoubleSide : THREE.FrontSide;
    body.material.needsUpdate = true;
    this.#draw();
  }

  /**
   * Fit the camera from the bounding sphere so a 40 mm CT core and a 600 mm
   * distribution core both arrive framed. `keepAngle` preserves the direction
   * the user is looking from, so typing a dimension re-fits without throwing
   * away the view they chose.
   */
  #frame(keepAngle) {
    const kit = this.#kit;
    if (!kit?.body) return;
    const { THREE, camera, controls } = kit;
    const box = new THREE.Box3().setFromObject(kit.body);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = (sphere.radius * 1.25) / Math.sin(Math.min(vFov, hFov) / 2);

    const dir = keepAngle && camera.position.lengthSq() > 1e-6
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(0.55, 0.62, 1).normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.near = Math.max(dist / 1000, 0.05);
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.update();   // ours to call: we moved the camera
    this.#draw();
  }

  #draw() {
    const kit = this.#kit;
    if (!kit) return;
    kit.renderer.render(kit.scene, kit.camera);
  }

  /* A visible page gets its repaint coalesced onto a frame; a hidden one still
     has correct numbers, and paints when it comes back. */
  #paint() {
    cancelAnimationFrame(this.#rafDraw);
    this.#rafDraw = requestAnimationFrame(() => this.#draw());
  }

  #resize() {
    const kit = this.#kit;
    if (!kit) return;
    const stage = this.shadowRoot.querySelector('.stage');
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    kit.renderer.setSize(w, h, false);
    kit.camera.aspect = w / h;
    kit.camera.updateProjectionMatrix();
    this.#draw();
  }

  /* ── disposal ─────────────────────────────────────────────────────────── */

  #releaseMeshes() {
    const kit = this.#kit;
    if (!kit) return;
    for (const node of [kit.body, kit.dims]) if (node) kit.scene.remove(node);
    kit.body = null; kit.dims = null;
    // WebGL resources are not garbage collected with their JS wrappers, so a
    // slider dragged across its range leaks a few hundred buffers unless every
    // rebuild hands them back.
    for (const d of this.#disposables) d.dispose?.();
    this.#disposables = [];
  }

  #teardown() {
    this.#releaseMeshes();
    const kit = this.#kit;
    if (!kit) return;
    kit.controls.dispose();
    kit.renderer.dispose();
    kit.renderer.domElement.remove();
    this.#kit = null;
  }
}

/* Guarded so this module can be imported by a test runner with no DOM — the
   maths above is worth testing on its own and should not need a browser. */
if (typeof customElements !== 'undefined' && !customElements.get('wound-core-viewer')) {
  customElements.define('wound-core-viewer', WoundCoreViewer);
}
