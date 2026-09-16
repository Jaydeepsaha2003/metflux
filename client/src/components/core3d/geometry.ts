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

/** The SS case around a nano core: a band wrapping the outside and inside, and
 *  a disc top and bottom. Modelled as one annulus slightly larger than the core
 *  in every direction — the viewer draws it translucent, so its job is to show
 *  that a case is fitted, not to be a manufacturing drawing of it. */
export const nanoCase = (t: Tri): THREE.BufferGeometry =>
  annulus({ id: Math.max(1, t.id - 5), od: t.od + 5, ht: t.ht + 5 });
