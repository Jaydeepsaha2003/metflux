// Turning the dimensions into three.js solids.
//
// Everything here is in millimetres, exactly as entered, and the viewer scales
// the finished group to fit its frame. Keeping the geometry at true scale means
// a composite's two halves sit together correctly without a second conversion.
//
// A note on the toroidal shape, because it is the easy thing to get wrong:
// THREE.TorusGeometry is a doughnut — a ring with a CIRCULAR cross-section. A
// wound core has a RECTANGULAR cross-section: it is a washer, not a doughnut.
// So the toroidal and nano cores are annular cylinders assembled from two walls
// and two flat faces, and the rectangular core is an extruded ring. Nothing
// here uses TorusGeometry.
//
// This module imports three.js, so it must only ever be reached from inside the
// lazy viewer chunk. The pure helpers live in ./shape.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Tri } from './shape';

/** Radial resolution. 96 is smooth at any size this viewer shows and still
 *  only a few thousand triangles — the whole scene stays under a frame budget
 *  that a low-end office laptop can redraw without its fan noticing. */
const RADIAL = 96;

/** An annular cylinder — the washer described above. Centred on the origin and
 *  lying in XZ with its height along Y, so the viewer can stack pieces by
 *  simply offsetting Y.
 *
 *  Built from four primitives welded together rather than revolved as one
 *  profile. A LatheGeometry averages its normals around the profile corners,
 *  which domes the top edge and makes a wound core look like a rubber seal.
 *  Assembling it from two walls and two faces keeps the cylindrical surfaces
 *  smoothly shaded while the four rim edges stay crisp, which is what the part
 *  actually looks like. */
export const annulus = (t: Tri): THREE.BufferGeometry => {
  const ri = Math.max(t.id / 2, 0.001);
  const ro = t.od / 2;
  const h = t.ht;

  const outerWall = new THREE.CylinderGeometry(ro, ro, h, RADIAL, 1, true);

  // Mirroring a rotationally symmetric cylinder in X flips its winding, so the
  // bore's surface faces into the hole instead of out through the metal.
  const innerWall = new THREE.CylinderGeometry(ri, ri, h, RADIAL, 1, true);
  innerWall.scale(-1, 1, 1);

  const face = (y: number, up: boolean) => {
    const g = new THREE.RingGeometry(ri, ro, RADIAL);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  };

  const merged = mergeGeometries(
    [outerWall, innerWall, face(h / 2, true), face(-h / 2, false)],
    false,
  );
  [outerWall, innerWall].forEach((g) => g.dispose());
  return merged ?? outerWall;
};

/**
 * One half of a cut core: an annulus swept through half a turn.
 *
 * A cut core is a wound core sliced across a diameter into two mating C halves.
 * Drawing it as a whole ring with a line on it would not show the thing that
 * makes it a different product, so each half is a real solid with real cut
 * faces — and the pair is drawn with a small separation so the joint is visible
 * even before a gap is specified.
 *
 * `startAngle` picks which half. Built centred on the origin like every other
 * solid here; see the coordinate-space note in dimensions.ts.
 */
export const halfAnnulus = (t: Tri, startAngle: number): THREE.BufferGeometry => {
  const ri = Math.max(t.id / 2, 0.001);
  const ro = t.od / 2;
  const h = t.ht;
  const seg = Math.max(8, Math.round(RADIAL / 2));

  const outerWall = new THREE.CylinderGeometry(ro, ro, h, seg, 1, true, startAngle, Math.PI);
  const innerWall = new THREE.CylinderGeometry(ri, ri, h, seg, 1, true, startAngle, Math.PI);
  // Flip the bore so its surface faces into the hole rather than out through
  // the metal. Scaling would mirror the arc onto the wrong half, so the winding
  // is reversed by drawing it back to front instead.
  innerWall.scale(1, 1, 1);
  const innerIdx = innerWall.getIndex();
  if (innerIdx) {
    const a = Array.from(innerIdx.array);
    for (let i = 0; i < a.length; i += 3) { const t0 = a[i]; a[i] = a[i + 2]; a[i + 2] = t0; }
    innerWall.setIndex(a);
  }
  const nrm = innerWall.getAttribute('normal');
  for (let i = 0; i < nrm.count; i += 1) {
    nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  }
  nrm.needsUpdate = true;

  const face = (y: number, up: boolean) => {
    const g = new THREE.RingGeometry(ri, ro, seg, 1, startAngle, Math.PI);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  };

  // The two flat cut faces, one at each end of the half turn.
  const cutFace = (angle: number) => {
    const g = new THREE.PlaneGeometry(ro - ri, h);
    g.rotateY(Math.PI / 2);
    g.translate(0, 0, (ro + ri) / 2);
    g.rotateY(-angle);
    return g;
  };

  const merged = mergeGeometries(
    [outerWall, innerWall, face(h / 2, true), face(-h / 2, false),
     cutFace(startAngle), cutFace(startAngle + Math.PI)],
    false,
  );
  [outerWall, innerWall].forEach((g) => g.dispose());
  return merged ?? outerWall;
};

/** A rectangular window core: outer rectangle with a rectangular hole,
 *  extruded through the stack height.
 *
 *  Real cut cores have radiused inner corners rather than sharp ones, so the
 *  window is drawn with a small fillet. It is cosmetic — no dimension depends
 *  on it — but sharp internal corners read as a CAD mistake to anyone who has
 *  handled the part. */
export const rectRing = (
  id1: number, id2: number, od1: number, od2: number, ht: number,
): THREE.BufferGeometry => {
  const rounded = (w: number, d: number, r: number) => {
    const s = new THREE.Shape();
    const x = w / 2, z = d / 2;
    const k = Math.max(0, Math.min(r, Math.min(w, d) / 2 - 0.01));
    s.moveTo(-x + k, -z);
    s.lineTo(x - k, -z);
    s.quadraticCurveTo(x, -z, x, -z + k);
    s.lineTo(x, z - k);
    s.quadraticCurveTo(x, z, x - k, z);
    s.lineTo(-x + k, z);
    s.quadraticCurveTo(-x, z, -x, z - k);
    s.lineTo(-x, -z + k);
    s.quadraticCurveTo(-x, -z, -x + k, -z);
    return s;
  };

  const outer = rounded(od1, od2, Math.min(od1, od2) * 0.04);
  const windowR = Math.min(id1, id2) * 0.12;
  const hole = rounded(id1, id2, windowR);
  outer.holes.push(new THREE.Path(hole.getPoints(48)));

  const g = new THREE.ExtrudeGeometry(outer, {
    depth: ht, bevelEnabled: false, curveSegments: 24,
  });
  // ExtrudeGeometry builds along +Z from the XY plane; rotate so the stack
  // height runs along Y like every other shape, then centre it.
  g.rotateX(-Math.PI / 2);
  g.translate(0, -ht / 2, 0);
  return g;
};

/**
 * One half of a rectangular cut core: the window core sawn straight across
 * both limbs, leaving a C.
 *
 * Built as a single C-shaped polygon rather than by clipping the full ring,
 * because there is no boolean geometry here to clip with. Tracing the outline
 * by hand is also the only way to keep the cut faces sharp — a saw cut has no
 * radius — while the outer corners and the window keep theirs.
 *
 * `sign` picks the half: +1 keeps the side at positive depth, -1 the other.
 */
export const halfRectRing = (
  id1: number, id2: number, od1: number, od2: number, ht: number, sign: 1 | -1,
  /** Where the cut falls along the ID2 axis, mm off centre. The extrusion maps
   *  shape-Y to world -Z, so the sign is flipped on the way in. */
  cutOffset = 0,
): THREE.BufferGeometry => {
  const X = od1 / 2, Z = (od2 / 2) * sign;
  const xi = id1 / 2, zi = (id2 / 2) * sign;
  // Clamped inside the window: a cut past it would leave the shape open and
  // the extrusion would come out inside-out rather than merely wrong.
  const cut = Math.max(-id2 / 2 + 0.5, Math.min(id2 / 2 - 0.5, -cutOffset));
  const rOuter = Math.min(od1, od2) * 0.04;
  const rWin = Math.min(id1, id2) * 0.12;

  const sh = new THREE.Shape();
  // Up the left outer wall from the cut face.
  sh.moveTo(-X, cut);
  sh.lineTo(-X, Z - rOuter * sign);
  sh.quadraticCurveTo(-X, Z, -X + rOuter, Z);
  // Across the outer end.
  sh.lineTo(X - rOuter, Z);
  sh.quadraticCurveTo(X, Z, X, Z - rOuter * sign);
  // Back down the right outer wall to the cut face.
  sh.lineTo(X, cut);
  // In along the cut face to the window, then around the window and back out.
  sh.lineTo(xi, cut);
  sh.lineTo(xi, zi - rWin * sign);
  sh.quadraticCurveTo(xi, zi, xi - rWin, zi);
  sh.lineTo(-xi + rWin, zi);
  sh.quadraticCurveTo(-xi, zi, -xi, zi - rWin * sign);
  sh.lineTo(-xi, cut);
  sh.closePath();

  const g = new THREE.ExtrudeGeometry(sh, { depth: ht, bevelEnabled: false, curveSegments: 16 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -ht / 2, 0);
  return g;
};

/** The SS case around a nano core: a band wrapping the outside and inside, and
 *  a disc top and bottom. Modelled as one annulus slightly larger than the core
 *  in every direction — the viewer draws it translucent, so its job is to show
 *  that a case is fitted, not to be a manufacturing drawing of it. */
/**
 * A stacked E lamination — the E body only; the I bar is a separate solid, as
 * it is a separate part.
 *
 * Extruded from a front-on outline with the two windows punched out as holes,
 * then stood upright. The extrusion runs along the shape's own Z, which after
 * the rotation below becomes the stack depth.
 */
export const eCoreE = (
  tongue: number, windowW: number, windowH: number, stack: number,
): THREE.BufferGeometry => {
  const yoke = tongue / 2;
  const width = tongue * 2 + windowW * 2;
  const eHeight = windowH + yoke;

  const outline = new THREE.Shape();
  outline.moveTo(-width / 2, -eHeight / 2);
  outline.lineTo(width / 2, -eHeight / 2);
  outline.lineTo(width / 2, eHeight / 2);
  outline.lineTo(-width / 2, eHeight / 2);
  outline.closePath();

  // Both windows sit on the yoke and stop at the top of the E.
  const window = (cx: number) => {
    const p = new THREE.Path();
    const x0 = cx - windowW / 2, x1 = cx + windowW / 2;
    const y0 = -eHeight / 2 + yoke, y1 = y0 + windowH;
    p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.closePath();
    return p;
  };
  const offset = (tongue + windowW) / 2;
  outline.holes.push(window(-offset), window(offset));

  const g = new THREE.ExtrudeGeometry(outline, {
    depth: stack, bevelEnabled: false, curveSegments: 4,
  });
  // Centre the extrusion on its own depth before standing it up, or the part
  // hangs off its origin and every camera fit is thrown by half a stack.
  g.translate(0, 0, -stack / 2);
  return g;
};

/** The I bar that closes an E core. */
export const eCoreI = (
  tongue: number, windowW: number, stack: number,
): THREE.BufferGeometry => {
  const width = tongue * 2 + windowW * 2;
  const g = new THREE.BoxGeometry(width, tongue / 2, stack);
  return g;
};

/**
 * An obround — the racetrack wound core.
 *
 * Built from a stadium outline with a stadium hole, which is the one thing
 * that makes it not a rectangular core: the ends are true semicircles, so the
 * strip has something it can actually be wound around.
 */
export const obround = (
  id1: number, id2: number, od1: number, od2: number, ht: number,
): THREE.BufferGeometry => {
  const stadium = (w: number, d: number) => {
    const s = new THREE.Shape();
    const r = Math.min(w, d) / 2;
    const x = Math.max(0, w / 2 - r), z = Math.max(0, d / 2 - r);
    s.moveTo(-x, -z - r);
    s.lineTo(x, -z - r);
    s.absarc(x, -z, r, -Math.PI / 2, 0, false);
    s.lineTo(x + r, z);
    s.absarc(x, z, r, 0, Math.PI / 2, false);
    s.lineTo(-x, z + r);
    s.absarc(-x, z, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-x - r, -z);
    s.absarc(-x, -z, r, Math.PI, Math.PI * 1.5, false);
    return s;
  };

  const outer = stadium(od1, od2);
  outer.holes.push(new THREE.Path(stadium(id1, id2).getPoints(64)));

  const g = new THREE.ExtrudeGeometry(outer, {
    depth: ht, bevelEnabled: false, curveSegments: 24,
  });
  g.translate(0, 0, -ht / 2);
  g.rotateX(-Math.PI / 2);
  return g;
};

/** One plate of a stepped limb. Stacked by the caller, widest in the middle. */
export const stepPlate = (
  width: number, thickness: number, length: number,
): THREE.BufferGeometry => new THREE.BoxGeometry(width, thickness, length);

export const nanoCase = (t: Tri): THREE.BufferGeometry =>
  annulus({ id: Math.max(1, t.id - 5), od: t.od + 5, ht: t.ht + 5 });
