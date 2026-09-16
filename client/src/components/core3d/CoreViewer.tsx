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
import { annulus, halfAnnulus, rectRing, halfRectRing, nanoCase } from './geometry';
import { compositeLayout, shapeExtent, shapeIsDrawable, type CoreShape } from './shape';
import { buildDimensions } from './dimensions';

/* Steel that reads as steel.
   These were the tab colours — amber, rose, violet — which made the model
   match the form but look like painted plastic. A wound core is grey metal, so
   the palette is grey metal, and the tab colour lives on the panel border
   where it belongs.

   The families still differ, because on a composite you have to be able to
   tell the two halves apart: CRGO is the lighter, slightly warm silicon steel,
   nanocrystalline ribbon is noticeably darker and cooler, and the case is
   brighter stainless. Roughness does as much work as colour here — a rougher
   surface scatters the studio reflection and reads as a wound stack rather
   than a machined billet. */
const MATERIALS = {
  crgo:  { color: 0xb6b8b6, metalness: 0.88, roughness: 0.38 },  // silicon steel
  steel: { color: 0xc6ccd2, metalness: 0.92, roughness: 0.26 },  // stainless case
  nano:  { color: 0x8d949c, metalness: 0.84, roughness: 0.44 },  // nanocrystalline ribbon
  rect:  { color: 0xb2b5b8, metalness: 0.88, roughness: 0.38 },  // silicon steel
} as const;

type Props = {
  shape: CoreShape;
  /** Re-frames the camera when this changes — used by the Reset view button. */
  resetNonce: number;
  /** Draw dimension lines and values over the part. */
  showDims: boolean;
};

/** The default three-quarter view: front, right, slightly above. */
const DEFAULT_DIR = new THREE.Vector3(0.62, 0.52, 0.78).normalize();

/** How much empty space to leave around the part, as a multiple of the
 *  distance that would make it exactly touch the edges. */
const FIT_MARGIN = 1.22;

type Kit = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  dims: THREE.Group;
  render: () => void;
};

/**
 * Put the whole part in frame, whatever its size.
 *
 * Cores in this app run from a 10mm bore to something you need two people to
 * lift, so no fixed camera distance works: the distance has to come from the
 * geometry every time. This takes the part's bounding sphere and solves for the
 * distance at which it fits, then backs off by a margin so it is not jammed
 * against the edges.
 *
 * Both fields of view matter. The vertical one is fixed by the lens, but the
 * horizontal follows the panel's aspect ratio, and in a dock that is wider than
 * it is tall the vertical is the tighter of the two. Fitting to the vertical
 * alone leaves a tall core cropped top and bottom, which is exactly what a
 * 10 x 20 x 30 core did.
 *
 * `keepAngle` preserves wherever the user has rotated to and changes only the
 * distance — so typing a dimension re-fits without throwing away the view they
 * chose. Reset passes false to return to the default three-quarter.
 */
const frame = (k: Kit, { keepAngle }: { keepAngle: boolean }) => {
  // Fit the part AND its dimension lines. Those lines stand off the metal by
  // design, so framing the solid alone would crop them.
  //
  // The value labels are excluded: they are sprites whose world size is chosen
  // for legibility, and letting a long piece of text shrink the part it is
  // annotating gets the priority backwards. A label may overhang; the fit
  // margin leaves it room.
  const box = new THREE.Box3().setFromObject(k.group);
  if (box.isEmpty()) return;
  k.dims.traverse((o) => {
    if (o.userData.noFit || o === k.dims) return;
    box.expandByObject(o);
  });
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;

  const vFov = (k.camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * k.camera.aspect);
  const dist = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * FIT_MARGIN;

  // Keep the direction the user is looking from, if they have moved at all.
  const dir = keepAngle
    ? k.camera.position.clone().sub(k.controls.target).normalize()
    : DEFAULT_DIR.clone();
  if (!keepAngle || dir.lengthSq() < 1e-6) dir.copy(DEFAULT_DIR);

  k.controls.target.copy(sphere.center);
  k.camera.position.copy(sphere.center).addScaledVector(dir, dist);

  // Clipping planes scaled to the part, so a 10mm core does not vanish into
  // the near plane and a 900mm one is not sliced by the far plane.
  k.camera.near = Math.max(sphere.radius / 500, 0.01);
  k.camera.far = dist + sphere.radius * 10;
  k.camera.updateProjectionMatrix();

  // Zoom limits that stop the user getting lost inside the metal or losing the
  // part to a speck in the distance.
  k.controls.minDistance = sphere.radius * 1.05;
  k.controls.maxDistance = dist * 3;

  k.controls.update();
  k.render();
};

export default function CoreViewer({ shape, resetNonce, showDims }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Releases the current annotation's geometry, materials and label textures.
  const disposeDims = useRef<(() => void) | null>(null);

  // Everything three.js owns lives in a ref, not state: touching it must never
  // trigger a React render, and it has to survive prop changes.
  const kit = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    group: THREE.Group;
    dims: THREE.Group;
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

    // Dimensions sit in their own group: toggling them must not rebuild the
    // solids, and rebuilding the solids must not strand their geometry.
    const dims = new THREE.Group();
    scene.add(dims);

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
      // Re-fit, not just re-render: the horizontal field of view follows the
      // aspect ratio, so a panel that narrows would crop the part at the sides
      // unless the camera backs off to match.
      if (kit.current && group.children.length) frame(kit.current, { keepAngle: true });
      else render();
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

    kit.current = { renderer, scene, camera, controls, group, dims, ground, grid, render, disposeContents };

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointerup', release);
      ro.disconnect();
      controls.dispose();
      disposeContents();
      disposeDims.current?.();
      disposeDims.current = null;
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
      case 'CUT_RECT': {
        const mat = mk(MATERIALS.rect);
        const split = shape.gapMm > 0
          ? shape.gapMm / 2
          : Math.max(shape.od2 * 0.004, 0.2);
        const a = add(halfRectRing(shape.id1, shape.id2, shape.od1, shape.od2, shape.ht, 1), mat);
        const b = add(halfRectRing(shape.id1, shape.id2, shape.od1, shape.od2, shape.ht, -1), mat);
        // The extrude is laid down with rotateX(-90), which maps the shape's
        // second axis to world -Z. So the +1 half lives at negative Z and has
        // to move further negative to open the joint; signing these the
        // obvious way pushed the halves through each other instead.
        a.position.z = -split;
        b.position.z = split;
        break;
      }
      case 'CUT_ROUND': {
        /* Two real halves rather than a ring with a line drawn on it. They are
           pushed apart by the specified gap, or by a hairline when there is no
           gap, so the joint is visible and the product reads as what it is. */
        const mat = mk(MATERIALS.crgo);
        const split = shape.gapMm > 0
          ? shape.gapMm / 2
          : Math.max(shape.dims.od * 0.004, 0.2);
        const top = add(halfAnnulus(shape.dims, 0), mat);
        const bot = add(halfAnnulus(shape.dims, Math.PI), mat);
        top.position.z = split;
        bot.position.z = -split;
        break;
      }
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

    // Sit the part on the floor and size the floor and grid to it, so the
    // shadow has somewhere to land and the grid reads as scale rather than
    // wallpaper. Measured before framing, because dropping the group changes
    // where its centre is.
    const box = new THREE.Box3().setFromObject(k.group);
    const extent = shapeExtent(shape) || 1;

    k.group.position.y = -box.min.y;
    k.ground.position.y = 0;
    k.ground.scale.setScalar(extent * 6);
    k.grid.position.y = 0.01;
    k.grid.scale.setScalar(extent * 3);

    frame(k, { keepAngle: true });
  }, [shape]);

  /* ---- dimension annotation ---- */
  useEffect(() => {
    const k = kit.current;
    if (!k) return;
    disposeDims.current?.();
    disposeDims.current = null;
    k.dims.clear();

    if (showDims && shapeIsDrawable(shape)) {
      const built = buildDimensions(shape, shapeExtent(shape) || 1);
      // Match the offset that drops the part onto the floor, so the annotation
      // sits against the feature it measures rather than floating below it.
      built.group.position.y = k.group.position.y;
      k.dims.add(built.group);
      disposeDims.current = built.dispose;
    }
    // Re-fit: turning the annotation on grows what has to be in shot, and
    // turning it off should let the part fill the frame again.
    frame(k, { keepAngle: true });
  }, [shape, showDims]);

  /* ---- explicit "reset view" ---- */
  useEffect(() => {
    const k = kit.current;
    if (!k || !shapeIsDrawable(shape) || k.group.children.length === 0) return;
    frame(k, { keepAngle: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  return <div ref={hostRef} className="h-full w-full" />;
}
