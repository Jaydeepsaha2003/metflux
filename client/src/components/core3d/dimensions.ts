// Dimension annotations drawn into the 3D scene.
//
// A dimension in an engineering drawing is a specific thing, not just a line
// with a number near it: two extension lines rising off the feature being
// measured, a dimension line between them capped with arrowheads, and the value
// sitting on that line. Anything less and a fitter reading it has to guess which
// two faces the number spans.
//
// The values ride on sprites rather than extruded text. A sprite always faces
// the camera, so the numbers stay square-on and legible however the part is
// rotated, which is the whole reason for putting them in the 3D view instead of
// a table beside it.
import * as THREE from 'three';
import { compositeLayout, type CoreShape } from './shape';

/** Drawn in a blueprint blue so the annotation never reads as part of the
 *  metal, and stays legible against both the pale stage and the core itself. */
const DIM_COLOR = 0x1d4ed8;
const DIM_TEXT = '#1d4ed8';

/** Everything below is expressed as a fraction of the part's overall extent, so
 *  the annotation looks identical on a 20mm core and a 900mm one. The camera
 *  fits the part to the frame, so proportional sizing is also constant on
 *  screen. */
const K = {
  arrow: 0.022,      // arrowhead length
  arrowR: 0.009,     // arrowhead base radius
  gap: 0.035,        // how far the dimension line stands off the feature
  ext: 0.014,        // how far extension lines overshoot the dimension line
  label: 0.165,      // sprite height
};

type Ctx = { group: THREE.Group; extent: number; disposables: Disposable[] };
type Disposable = { dispose: () => void };

/** A label that always faces the viewer. Drawn to a canvas at a fixed pixel
 *  size and scaled into the scene, so the glyphs stay crisp rather than being
 *  stretched from a small texture. */
const makeLabel = (text: string, extent: number, ctx: Ctx): THREE.Sprite => {
  const pad = 14;
  const font = 64;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `700 ${font}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const h = font + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  // A pill behind the text, so a number never lands on the metal and vanishes.
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.strokeStyle = DIM_TEXT;
  c.lineWidth = 3;
  const r = h / 2;
  c.beginPath();
  c.moveTo(r, 0); c.lineTo(w - r, 0);
  c.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  c.lineTo(r, h);
  c.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = DIM_TEXT;
  c.font = `700 ${font}px Inter, system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, w / 2, h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    // Drawn over the part rather than buried inside it: a dimension that
    // disappears behind the metal when you rotate is worse than none.
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  const hWorld = extent * K.label;
  sprite.scale.set((hWorld * w) / h, hWorld, 1);
  sprite.renderOrder = 10;
  // Excluded from camera framing — see fitBox() in CoreViewer. A label is
  // allowed to overhang; shrinking the part to fit its text would be backwards.
  sprite.userData.noFit = true;
  ctx.disposables.push(tex, mat);
  return sprite;
};

const lineMat = (ctx: Ctx) => {
  const m = new THREE.LineBasicMaterial({ color: DIM_COLOR, depthTest: false, transparent: true });
  ctx.disposables.push(m);
  return m;
};

const addLine = (pts: THREE.Vector3[], ctx: Ctx) => {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.Line(g, lineMat(ctx));
  l.renderOrder = 9;
  ctx.disposables.push(g);
  ctx.group.add(l);
};

/** A cone standing in for an arrowhead, pointed along `dir`. */
const addArrow = (at: THREE.Vector3, dir: THREE.Vector3, ctx: Ctx) => {
  const len = ctx.extent * K.arrow;
  const geo = new THREE.ConeGeometry(ctx.extent * K.arrowR, len, 12);
  const mat = new THREE.MeshBasicMaterial({ color: DIM_COLOR, depthTest: false, transparent: true });
  const cone = new THREE.Mesh(geo, mat);
  // Cones point up the Y axis by default; aim it down `dir`, which points from
  // the tip back into the dimension line.
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  cone.position.copy(at).addScaledVector(dir.clone().normalize(), len / 2);
  cone.renderOrder = 9;
  ctx.disposables.push(geo, mat);
  ctx.group.add(cone);
};

/**
 * One complete dimension: extension lines off the two measured points, a
 * dimension line between them with arrowheads turned inward, and the value.
 *
 * `offset` moves the dimension line clear of the part; `ext` is the direction
 * the extension lines run, normally the same way.
 */
const dimension = (
  a: THREE.Vector3, b: THREE.Vector3, offset: THREE.Vector3, text: string, ctx: Ctx,
) => {
  const A = a.clone().add(offset);
  const B = b.clone().add(offset);
  const over = offset.clone().normalize().multiplyScalar(ctx.extent * K.ext);

  // Extension lines: from just off the feature, past the dimension line.
  addLine([a.clone(), A.clone().add(over)], ctx);
  addLine([b.clone(), B.clone().add(over)], ctx);
  addLine([A, B], ctx);

  const inward = B.clone().sub(A).normalize();
  addArrow(A, inward, ctx);
  addArrow(B, inward.clone().negate(), ctx);

  const label = makeLabel(text, ctx.extent, ctx);
  label.position.copy(A).add(B).multiplyScalar(0.5);
  ctx.group.add(label);
};

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * Build the annotation group for a shape. Returns the group plus a dispose()
 * that releases every geometry, material and canvas texture it created —
 * called whenever the dimensions change, which is on every keystroke.
 */
export const buildDimensions = (shape: CoreShape, extent: number) => {
  const group = new THREE.Group();
  const disposables: Disposable[] = [];
  const ctx: Ctx = { group, extent, disposables };
  const gap = extent * K.gap;
  // Stacked dimensions are spaced by LABEL height, not by the small standoff
  // gap: two dimension lines a hair apart put their two pills on top of each
  // other, which is how the first attempt hid OD behind ID.
  const row = extent * K.label * 1.15;

  /* Toroidal, nano and composite are all annular: diameters across the top
     face, height up the side. */
  const annularDims = (id: number, od: number, ht: number, yBottom: number, yTop: number) => {
    const ro = od / 2;
    const ri = id / 2;
    const top = yTop + gap * 0.4;

    // OD on the first row above the top face, ID on the second.
    dimension(
      new THREE.Vector3(-ro, top, 0), new THREE.Vector3(ro, top, 0),
      new THREE.Vector3(0, row * 0.75, 0), `OD ${n(od)}`, ctx,
    );
    if (ri > 0) {
      dimension(
        new THREE.Vector3(-ri, top, 0), new THREE.Vector3(ri, top, 0),
        new THREE.Vector3(0, row * 1.95, 0), `ID ${n(id)}`, ctx,
      );
    }
    // HT up the right-hand side.
    dimension(
      new THREE.Vector3(ro, yBottom, 0), new THREE.Vector3(ro, yTop, 0),
      new THREE.Vector3(gap * 1.15, 0, 0), `HT ${n(ht)}`, ctx,
    );
  };

  switch (shape.kind) {
    case 'TOROIDAL':
    case 'NANO': {
      const { id, od, ht } = shape.dims;
      annularDims(id, od, ht, 0, ht);
      break;
    }
    case 'COMPOSITE': {
      const { totalHt } = compositeLayout(shape.rule, shape.crgo, shape.nano);
      const id = Math.min(shape.crgo.id, shape.nano.id);
      const od = Math.max(shape.crgo.od, shape.nano.od);
      annularDims(id, od, totalHt, 0, totalHt);
      break;
    }
    case 'RECTANGULAR': {
      const { id1, id2, od1, od2, ht } = shape;
      const x = od1 / 2, z = od2 / 2, xi = id1 / 2, zi = id2 / 2;
      const top = ht + gap * 0.4;
      // OD 1 across the front edge, OD 2 down the right edge, both on the top
      // face; the window dimensions sit above them so nothing overlaps.
      // The two X-spanning dimensions stack in front; the two Z-spanning ones
      // stack out to the left. Four on one side would be a ladder nobody reads.
      dimension(
        new THREE.Vector3(-x, top, z), new THREE.Vector3(x, top, z),
        new THREE.Vector3(0, row * 0.75, 0), `OD1 ${n(od1)}`, ctx,
      );
      dimension(
        new THREE.Vector3(-xi, top, zi), new THREE.Vector3(xi, top, zi),
        new THREE.Vector3(0, row * 1.95, 0), `ID1 ${n(id1)}`, ctx,
      );
      dimension(
        new THREE.Vector3(-x, top, -z), new THREE.Vector3(-x, top, z),
        new THREE.Vector3(0, row * 0.75, 0), `OD2 ${n(od2)}`, ctx,
      );
      dimension(
        new THREE.Vector3(-xi, top, -zi), new THREE.Vector3(-xi, top, zi),
        new THREE.Vector3(0, row * 1.95, 0), `ID2 ${n(id2)}`, ctx,
      );
      dimension(
        new THREE.Vector3(x, 0, -z), new THREE.Vector3(x, ht, -z),
        new THREE.Vector3(gap * 1.15, 0, -gap), `HT ${n(ht)}`, ctx,
      );
      break;
    }
  }

  return {
    group,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      group.clear();
    },
  };
};
