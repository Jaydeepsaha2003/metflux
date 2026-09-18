# `<wound-core-viewer>`

A parametric 3D viewer for a rectangular (racetrack / obround) wound
transformer or CT core. One vanilla custom element, Shadow DOM, no framework,
no build step.

```html
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/"
} }
</script>
<script type="module" src="./wound-core-viewer.js"></script>

<wound-core-viewer
  window-length="200" window-width="60" corner-radius="30"
  build="40" strip-width="60"
  strip-thickness="0.27" stacking-factor="0.96" density="7.65">
</wound-core-viewer>
```

Open `demo.html` for two worked presets: a small LT CT core and a
single-phase distribution core.

## Parameters

All lengths in millimetres. Attributes and properties reflect both ways, so
the DOM stays the source of truth; `setParams({...})` writes the attributes
rather than going behind them.

| Attribute | Symbol | Meaning |
|---|---|---|
| `window-length` | A | inner window length |
| `window-width` | B | inner window width |
| `corner-radius` | r | inner corner radius. `B/2` gives a true obround |
| `build` | D | radial build |
| `strip-width` | H | strip width, which is the core's height |
| `strip-thickness` | t | 0.27, 0.30 … |
| `stacking-factor` | SF | 0.95–0.97 typical for CRGO |
| `density` | ρ | g/cm³ — 7.65 CRGO, ~8.7 nickel-iron |

The **outer** profile is not an input. Strip cannot make a sharp bend and each
wrap sits on a larger radius than the one beneath it, so the outer corner
radius is always `r + D` and the outside size is always `(A + 2D) × (B + 2D)`.
Taking them as separate inputs would let you describe a core that cannot be
wound.

### Events and properties

`change` fires on every parameter update, valid or not:

```js
el.addEventListener('change', (e) => {
  e.detail.params;    // what was asked for
  e.detail.derived;   // every figure below, or null if it was refused
  e.detail.errors;    // plain sentences, empty when it built
});
```

`el.params` and `el.derived` read the same values synchronously.

## Formulas

Shown on screen beside each number, because this is a tool for learning the
product as much as for drawing it.

```
P  = 2(A + B) − 8r + 2πr      inner window perimeter
Lm = P + πD                   mean magnetic path
Ag = D × H                    gross area
Ae = Ag × SF                  net core area
V  = Ae × Lm                  steel volume
W  = V × ρ ÷ 1e6              weight, kg
N  = D ÷ t                    wraps
L  = D × Lm ÷ t               strip length
```

Two of these are worth a sentence each.

**`Lm = P + πD` is exact, not an approximation.** Offsetting a rounded
rectangle outward by `d` adds exactly `2πd` to its perimeter, whatever the
straight runs are doing — so the mean wrap, half a build out, adds `πD`. It is
also exactly the average of the inner and outer perimeters, which the tests
assert.

**`W = V × ρ ÷ 1e6`.** Volume comes out in mm³ and density is quoted in g/cm³,
which is grams per 1000 mm³. The `1e6` is the only unit conversion in the file
and it lives in one place. Getting it wrong gives a core a thousand times too
heavy, so there is a test that pins a 200 × 60 × 40 × 60 CRGO core at
10.47 kg.

Everything magnetic uses the **net** area `Ae`. Costing sometimes wants gross,
which is why both are reported.

## Assumptions

- **Uncut core.** No joint, no air gap, so `Lm` is the whole magnetic path. A
  cut core needs the gap's ampere-turns added separately and is a different
  product.
- **Uniform build** all the way round, and **constant corner radius through the
  build** — the inner radius plus however much steel has been laid on.
- **Stacking factor is a single scalar.** Real coating thickness and winding
  tension vary through the build; one figure is the trade convention.
- **Density, and nothing else, is material-dependent here.** Permeability and
  loss curves belong on a material record, not in this component — which is
  why `density` is an input rather than a constant. Nickel-iron at ~8.7 g/cm³
  works today; its permeability and loss do not, because this viewer does not
  model them.
- **Geometry only.** No winding, no core box, no tape, no busbar.

## Things worth knowing about the implementation

**Import map, not a UMD script tag.** The brief asked for a pinned UMD build.
three.js stopped shipping a non-module `OrbitControls` after r147, so a
script-tag build would mean either a five-year-old three or a second copy of
the library on the page. An import map pins exactly as firmly, keeps one copy
and still needs no bundler. The component asks only for the bare specifiers
`three` and `three/addons/…`, so pointing the map at a local copy runs it
offline; it falls back to the pinned CDN if no map is present. Set
`WoundCoreViewer.three = { THREE, OrbitControls }` to skip the network
entirely.

**Wraps are drawn, not modelled.** `min(40, floor(D/t))` concentric outlines on
the two faces. A real core is 150 wraps; as separate extrusions that is
geometry nobody can see the inside of, at a cost the frame rate notices.

**The arithmetic does not wait on an animation frame.** Rebuilds are coalesced
onto a microtask and only the WebGL draw is scheduled with
`requestAnimationFrame`. A hidden tab does not run rAF at all — scheduling the
model there meant a backgrounded page computed nothing, emitted no `change`
and showed an empty panel. A host that only wants the numbers now gets them
whether or not anything is on screen.

**`controls.update()` dispatches `change`.** So the `change` handler renders and
nothing else. Wiring it the obvious way — handler calls `update()`, `update()`
fires `change` — recurses until the stack gives out, which is how this was
found: a blank canvas and `Maximum call stack size exceeded`. Damping is off
for the same reason; it needs a continuous loop, which fights on-demand
rendering.

**Metal needs something to reflect.** `MeshStandardMaterial` at metalness 0.85
renders near-black with lights alone. `RoomEnvironment` is built from geometry
in code rather than loaded, so the brushed finish costs no HDR asset. If it
cannot be imported the material drops to a duller, more diffuse setting rather
than shipping a black core.

**Disposal on every rebuild.** WebGL resources are not garbage collected with
their JS wrappers, so a slider dragged across its range leaks a few hundred
buffers unless each rebuild hands them back. Verified by driving 40 rebuilds
in a row with no errors and no growth.

## Tests

```bash
cd tools/wound-core-viewer && npm test
```

Nine tests, no DOM and no WebGL — the module guards its `HTMLElement` base
class so the maths can be imported by a plain node runner. They cover the
perimeter formula against the polygon it describes, both degenerate shapes
(`r = B/2` → true obround, `A = B` with `r = A/2` → circle), every validation
rule, the worked example above, and that strip length equals the sum of every
individual wrap rather than an approximation of it.
