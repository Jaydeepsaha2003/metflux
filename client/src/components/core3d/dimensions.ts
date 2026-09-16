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
//
// COORDINATE SPACE — the thing to get right. Every solid in geometry.ts is built
// centred on the origin, spanning -HT/2 to +HT/2, and the viewer then lifts the
// whole group so the part sits on the floor. This module must author in that
// same centred space, because the annotation group receives the same lift. Get
// it wrong and the dimensions float half a part-height above the metal they are
// meant to be measuring, attached to nothing.
import * as THREE from 'three';
import { compositeLayout, type CoreShape } from './shape';

/** Drawn in a blueprint blue so the annotation never reads as part of the
 *  metal, and stays legible against both the pale stage and the core itself. */
const DIM_COLOR = 0x1d4ed8;
const DIM_TEXT = '#1d4ed8';

/* The label's world height sets the scale of everything else. Arrowheads, row
   spacing and standoff are multiples of IT rather than of the part, so a head
   always looks like it belongs to the number beside it — on a 20mm core and a
   900mm one alike. Sizing arrows off the part instead is what made them
   invisible on a tall, narrow core. */
const LABEL_H = 0.15;        // fraction of the part's overall extent
const ARROW_LEN = 0.44;      // of label height
const ARROW_RAD = 0.16;      // of label height
const ROW = 2.3;             // gap between stacked dimension lines
const STANDOFF = 0.8;        // first dimension line's distance off the feature
const OVERSHOOT = 0.3;       // how far extension lines pass the dimension line
const CLEAR = 0.2;           // gap between the feature and its extension line
const SIDE = 1.5;            // how far the height dimension stands off the wall

type Ctx = {
  group: THREE.Group;
  labelH: number;
  disposables: Disposable[];
};
type Disposable = { dispose: () => void };

/** A label that always faces the viewer. Drawn to a canvas at a fixed pixel
 *  size and scaled into the scene, so the glyphs stay crisp rather than being
 *  stretched from a small texture. */
const makeLabel = (text: string, ctx: Ctx): THREE.Sprite => {
  const pad = 16;
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
  c.fillStyle = 'rgba(255,255,255,0.94)';
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
  const worldW = (ctx.labelH * w) / h;
  sprite.scale.set(worldW, ctx.labelH, 1);
  sprite.userData.worldWidth = worldW;
  sprite.renderOrder = 12;
  // Excluded from camera framing — see fitBox() in CoreViewer. A label is
  // allowed to overhang; shrinking the part to fit its text would be backwards.
  sprite.userData.noFit = true;
  ctx.disposables.push(tex, mat);
  return sprite;
};

const addLine = (pts: THREE.Vector3[], ctx: Ctx) => {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = new THREE.LineBasicMaterial({ color: DIM_COLOR, depthTest: false, transparent: true });
  const l = new THREE.Line(g, m);
  l.renderOrder = 10;
  ctx.disposables.push(g, m);
  ctx.group.add(l);
};

/**
 * A solid cone arrowhead with its POINT at `tip`, opening back along `back`.
 *
 * Three.js cones point up their own +Y and are centred on their middle, so the
 * quaternion aims that axis and the position steps half a length back from the
 * point — otherwise the head floats off the end of the line it belongs to.
 */
const addArrow = (tip: THREE.Vector3, back: THREE.Vector3, ctx: Ctx) => {
  const len = ctx.labelH * ARROW_LEN;
  const dir = back.clone().normalize();
  const geo = new THREE.ConeGeometry(ctx.labelH * ARROW_RAD, len, 16);
  const mat = new THREE.MeshBasicMaterial({ color: DIM_COLOR, depthTest: false, transparent: true });
  const cone = new THREE.Mesh(geo, mat);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  cone.position.copy(tip).addScaledVector(dir, len / 2);
  cone.renderOrder = 11;
  ctx.disposables.push(geo, mat);
  ctx.group.add(cone);
};

/**
 * One complete dimension.
 *
 * `a` and `b` are the two points ON THE PART being measured. `offset` carries
 * the dimension line clear of the metal; the extension lines run from just off
 * each feature to slightly past that line, and it is those two lines that tie
 * the number to the faces it spans.
 */
const dimension = (
  a: THREE.Vector3, b: THREE.Vector3, offset: THREE.Vector3, text: string, ctx: Ctx,
) => {
  const dir = offset.clone().normalize();
  const A = a.clone().add(offset);
  const B = b.clone().add(offset);
  const clear = dir.clone().multiplyScalar(ctx.labelH * CLEAR);
  const over = dir.clone().multiplyScalar(ctx.labelH * OVERSHOOT);

  addLine([a.clone().add(clear), A.clone().add(over)], ctx);
  addLine([b.clone().add(clear), B.clone().add(over)], ctx);
  addLine([A, B], ctx);

  // Heads sit at each end of the dimension line, pointing outwards at the
  // extension lines, as a drawing has them.
  const along = B.clone().sub(A).normalize();
  addArrow(A, along, ctx);
  addArrow(B, along.clone().negate(), ctx);

  /* Where the value goes.
     Centred on the dimension line normally. But on a short span — a 10mm bore
     with "ID 10" beside it — the pill is wider than the line it sits on, hides
     both arrowheads and reads as a label floating in space. Drafting practice
     is to move the value outside the arrows and that is what happens here:
     past the B end, on the line's own axis, still unambiguously attached. */
  const label = makeLabel(text, ctx);
  const span = B.clone().sub(A);
  const fits = (label.userData.worldWidth as number) < span.length() * 0.95;
  label.position.copy(A).add(B).multiplyScalar(0.5);
  if (!fits) {
    label.position.addScaledVector(
      span.clone().normalize(),
      span.length() / 2 + (label.userData.worldWidth as number) / 2 + ctx.labelH * 0.5,
    );
  }
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
  const labelH = extent * LABEL_H;
  const ctx: Ctx = { group, labelH, disposables };

  const stand = labelH * STANDOFF;
  const row = labelH * ROW;
  const side = labelH * SIDE;

  /* Toroidal, nano and composite are all annular: diameters stacked above the
     top face, height up the right-hand wall. Authored CENTRED — see the note at
     the top of this file. */
  const annularDims = (id: number, od: number, ht: number) => {
    const ro = od / 2;
    const ri = id / 2;
    const top = ht / 2;
    const bottom = -ht / 2;

    dimension(
      new THREE.Vector3(-ro, top, 0), new THREE.Vector3(ro, top, 0),
      new THREE.Vector3(0, stand, 0), `OD ${n(od)}`, ctx,
    );
    if (ri > 0) {
      dimension(
        new THREE.Vector3(-ri, top, 0), new THREE.Vector3(ri, top, 0),
        new THREE.Vector3(0, stand + row, 0), `ID ${n(id)}`, ctx,
      );
    }
    // Held a full label clear of the outer wall, so the value never lands on
    // the metal it is measuring.
    dimension(
      new THREE.Vector3(ro, bottom, 0), new THREE.Vector3(ro, top, 0),
      new THREE.Vector3(side, 0, 0), `HT ${n(ht)}`, ctx,
    );
  };

  switch (shape.kind) {
    case 'TOROIDAL':
    case 'NANO': {
      const { id, od, ht } = shape.dims;
      annularDims(id, od, ht);
      break;
    }
    case 'COMPOSITE': {
      const { totalHt } = compositeLayout(shape.rule, shape.crgo, shape.nano);
      const id = Math.min(shape.crgo.id, shape.nano.id);
      const od = Math.max(shape.crgo.od, shape.nano.od);
      annularDims(id, od, totalHt);
      break;
    }
    case 'RECTANGULAR': {
      const { id1, id2, od1, od2, ht } = shape;
      const x = od1 / 2, z = od2 / 2, xi = id1 / 2, zi = id2 / 2;
      const top = ht / 2, bottom = -ht / 2;

      // The two X-spanning dimensions stack in front; the two Z-spanning ones
      // stack out to the left. Four on one side would be a ladder nobody reads.
      dimension(
        new THREE.Vector3(-x, top, z), new THREE.Vector3(x, top, z),
        new THREE.Vector3(0, stand, 0), `OD1 ${n(od1)}`, ctx,
      );
      dimension(
        new THREE.Vector3(-xi, top, zi), new THREE.Vector3(xi, top, zi),
        new THREE.Vector3(0, stand + row, 0), `ID1 ${n(id1)}`, ctx,
      );
      dimension(
        new THREE.Vector3(-x, top, -z), new THREE.Vector3(-x, top, z),
        new THREE.Vector3(0, stand, 0), `OD2 ${n(od2)}`, ctx,
      );
      dimension(
        new THREE.Vector3(-xi, top, -zi), new THREE.Vector3(-xi, top, zi),
        new THREE.Vector3(0, stand + row, 0), `ID2 ${n(id2)}`, ctx,
      );
      dimension(
        new THREE.Vector3(x, bottom, -z), new THREE.Vector3(x, top, -z),
        new THREE.Vector3(side, 0, 0), `HT ${n(ht)}`, ctx,
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
