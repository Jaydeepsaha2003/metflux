import * as THREE from 'three';
import { gappedAnnulus, gappedRectRing, eCoreE } from './geometry';

// Rays through openings must never hit a cap, side wall or hidden bridge.
function expectHit(g: THREE.BufferGeometry, origin: number[], direction: number[], expected: boolean, label: string) {
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction));
  if ((ray.intersectObject(mesh).length > 0) !== expected) throw new Error(label);
  mesh.material.dispose();
}
const ring = gappedAnnulus({ id: 10, od: 20, ht: 30 }, 3);
expectHit(ring, [0, 40, -7], [0,-1,0], false, 'Round gap bridged by a cap');
expectHit(ring, [0, 0, -20], [0,0,1], true, 'Round back wall missing');
expectHit(ring, [7, 40, 0], [0,-1,0], true, 'Round steel missing');
const rect = gappedRectRing(10,20,20,30,8,3);
expectHit(rect,[7,40,0],[0,-1,0],false,'Rectangular joint bridged');
expectHit(rect,[-7,40,0],[0,-1,0],true,'Rectangular opposite limb missing');
const e = eCoreE(10,10,20,8);
for (const x of [-10,10]) {
  expectHit(e,[x,0,30],[0,0,-1],false,'E window closed');
  expectHit(e,[x,30,0],[0,-1,0],true,'E yoke missing');
  const ray = new THREE.Raycaster(new THREE.Vector3(x,30,0),new THREE.Vector3(0,-1,0));
  const mesh = new THREE.Mesh(e,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  const hits = ray.intersectObject(mesh);
  if (hits.some(hit => hit.point.y > -7.49)) throw new Error('E has bridge across open ends');
  mesh.material.dispose();
}
expectHit(e,[0,0,30],[0,0,-1],true,'E tongue missing');
[ring,rect,e].forEach(g=>g.dispose());
console.log('PASS: round gap, rectangular gap and open E-core geometry');
