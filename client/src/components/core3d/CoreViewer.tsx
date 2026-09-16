// The WebGL half of the core preview. Imperative three.js rather than a React
// renderer: the scene is a handful of meshes that change only when a dimension
// changes, and a wrapper library would cost more in bundle than it saves here.
//
// Two decisions worth stating, because both are about a form that sits open all
// day rather than a page someone visits for thirty seconds:
//
//   * Rendering is ON DEMAND. There is no requestAnimationFrame loop running in
//     the background. A frame is drawn when the geometry changes, while the
//     user is dragging, and while the camera glides after a reset. An idle tab
//     costs nothing, which matters when this is open beside forty other tabs on
//     an office laptop.
//
//   * Every geometry and material is disposed before it is replaced. Each
//     keystroke in a dimension field is a new solid; without disposal a booking
//     session would leak GPU memory steadily until the tab fell over.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { annulus, rectRing, nanoCase } from './geometry';
import { compositeLayout, shapeExtent, shapeIsDrawable, type CoreShape } from './shape';

/* Steel that reads as steel: high metalness, mid roughness, and a colour per
   core family matching the badge colours used elsewhere in the form so the
   model is recognisably the thing the tab is about. */
const MATERIALS = {
  crgo:  { color: 0xd8b25e, metalness: 0.92, roughness: 0.34 },  // warm silicon steel
  steel: { color: 0xb9c2cc, metalness: 0.94, roughness: 0.28 },  // bright rolled steel
  nano:  { color: 0x9d7bd8, metalness: 0.86, roughness: 0.38 },  // nanocrystalline ribbon
  rect:  { color: 0xd98f92, metalness: 0.90, roughness: 0.32 },
} as const;

type Props = {
  shape: CoreShape;
  /** Re-frames the camera when this changes — used by the Reset view button. */
  resetNonce: number;
};

export default function CoreViewer({ shape, resetNonce }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Everything three.js owns lives in a ref, not state: touching it must never
  // trigger a React render, and it has to survive prop changes.
  const kit = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    group: THREE.Group;
    ground: THREE.Mesh;
    grid: THREE.GridHelper;
    render: () => void;
    disposeContents: () => void;
  } | null>(null);

  /* ---- one-time scene setup ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.cursor = 'grab';

    const scene = new THREE.Scene();

    /* Metal needs something to reflect. A MeshStandardMaterial at metalness ~0.9
       with no environment renders almost black, because in a physically based
       model a mirror in a void shows the void — which is why a first attempt at
       a steel core always comes out looking like dark chocolate.

       RoomEnvironment is a procedural studio: a few emissive planes standing in
       for softboxes, generated at runtime. It costs no download and no texture
       fetch, and it is what gives the core its rolled-steel sheen and the soft
       gradient across the top face. */
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.9;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100_000);
    camera.position.set(1, 0.8, 1.6);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.8;
    controls.enablePan = false;          // panning a single part just loses it
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI - 0.15;

    /* Lighting. A key light with a soft shadow gives the part its form, a fill
       from the opposite side keeps the shadow side readable, and a rim light
       behind separates the silhouette from the background. The hemisphere light
       tints the ambient so the metal picks up a cool sky and a warm bounce
       instead of looking flat grey. */
    scene.add(new THREE.HemisphereLight(0xdce8f5, 0x8a7a63, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.4, 3.4, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0015;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xc9d8ea, 0.45);
    fill.position.set(-2.6, 1.2, -1.4);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(-0.6, 1.6, -3.0);
    scene.add(rim);

    /* A shadow-catching floor. It takes no colour of its own — only the shadow
       is visible — so the part appears to sit on the card rather than float in
       a grey box. */
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(1, 20, 0x94a3b8, 0xcbd5e1);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.28;
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);

    const render = () => renderer.render(scene, camera);

    // On-demand drawing: a frame per control change, plus a short damped tail
    // so the inertia after a flick still animates.
    let raf = 0;
    const tick = () => {
      raf = 0;
      const moving = controls.update();
      render();
      if (moving) raf = requestAnimationFrame(tick);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(tick); };
    controls.addEventListener('change', schedule);

    const grab = () => { renderer.domElement.style.cursor = 'grabbing'; };
    const release = () => { renderer.domElement.style.cursor = 'grab'; };
    renderer.domElement.addEventListener('pointerdown', grab);
    // Bound on the window, not the canvas: a drag that ends off the canvas must
    // still put the cursor back, or it stays stuck as a closed hand.
    window.addEventListener('pointerup', release);

    const ro = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    });
    ro.observe(host);

    const disposeContents = () => {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      group.clear();
    };

    kit.current = { renderer, scene, camera, controls, group, ground, grid, render, disposeContents };

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointerup', release);
      ro.disconnect();
      controls.dispose();
      disposeContents();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      envRT.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      kit.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- rebuild the solid whenever the dimensions change ---- */
  useEffect(() => {
    const k = kit.current;
    if (!k || !shapeIsDrawable(shape)) {
      k?.disposeContents();
      k?.render();
      return;
    }
    k.disposeContents();

    const mk = (spec: typeof MATERIALS[keyof typeof MATERIALS], opts?: Partial<THREE.MeshStandardMaterialParameters>) =>
      new THREE.MeshStandardMaterial({ ...spec, ...opts });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      k.group.add(mesh);
      return mesh;
    };

    switch (shape.kind) {
      case 'TOROIDAL':
        add(annulus(shape.dims), mk(MATERIALS.crgo));
        break;
      case 'RECTANGULAR':
        add(rectRing(shape.id1, shape.id2, shape.od1, shape.od2, shape.ht), mk(MATERIALS.rect));
        break;
      case 'NANO': {
        add(annulus(shape.dims), mk(MATERIALS.nano));
        if (shape.cased) {
          // The case is drawn as a glassy shell so the ribbon inside stays
          // visible — the point is "a case is fitted", not to hide the core.
          const shell = add(nanoCase(shape.dims), mk(MATERIALS.steel, {
            transparent: true, opacity: 0.26, roughness: 0.16, side: THREE.DoubleSide,
          }));
          shell.castShadow = false;
        }
        break;
      }
      case 'COMPOSITE': {
        const { crgoY, nanoY } = compositeLayout(shape.rule, shape.crgo, shape.nano);
        add(annulus(shape.crgo), mk(MATERIALS.crgo), crgoY);
        add(annulus(shape.nano), mk(MATERIALS.nano), nanoY);
        break;
      }
    }

    // Frame the part: sit it on the floor, size the grid to it, and pull the
    // camera back to whatever distance actually fits the bounding sphere.
    const box = new THREE.Box3().setFromObject(k.group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const extent = shapeExtent(shape) || 1;

    k.group.position.y = -box.min.y;
    k.ground.position.y = 0;
    k.ground.scale.setScalar(extent * 6);
    k.grid.position.y = 0.01;
    k.grid.scale.setScalar(extent * 3);

    const fitDist = sphere.radius / Math.sin((k.camera.fov * Math.PI) / 180 / 2);
    k.controls.target.set(0, box.max.y - box.min.y > 0 ? (box.max.y - box.min.y) / 2 : 0, 0);
    k.controls.minDistance = sphere.radius * 1.1;
    k.controls.maxDistance = fitDist * 4;
    k.camera.near = Math.max(0.1, sphere.radius / 100);
    k.camera.far = fitDist * 20;
    k.camera.updateProjectionMatrix();

    // Only re-seat the camera when it has nothing sensible to keep — otherwise
    // typing a dimension would yank the view back and undo the user's rotation.
    if (k.camera.position.length() <= 2.01) {
      k.camera.position.set(fitDist * 0.62, fitDist * 0.52, fitDist * 0.78);
    }
    k.controls.update();
    k.render();
  }, [shape]);

  /* ---- explicit "reset view" ---- */
  useEffect(() => {
    const k = kit.current;
    if (!k || !shapeIsDrawable(shape)) return;
    const box = new THREE.Box3().setFromObject(k.group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
    const fitDist = sphere.radius / Math.sin((k.camera.fov * Math.PI) / 180 / 2);
    k.camera.position.set(fitDist * 0.62, fitDist * 0.52, fitDist * 0.78);
    k.controls.target.set(0, (box.max.y - box.min.y) / 2, 0);
    k.controls.update();
    k.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  return <div ref={hostRef} className="h-full w-full" />;
}
