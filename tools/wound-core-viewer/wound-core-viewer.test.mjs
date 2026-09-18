/**
 * Tests for the wound-core maths. No DOM, no WebGL, no three.js.
 *
 *   node --test tools/wound-core-viewer/
 *
 * The two shapes worth pinning are the degenerate ones, because they are the
 * ones a generic rounded-rectangle routine gets wrong: r = B/2 is the normal
 * product, not an edge case, and A = B with r = A/2 has to come out a circle
 * rather than a rectangle with suspiciously round corners.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, validate, roundedRectPoints, polylinePerimeter, derive,
} from './wound-core-viewer.js';

const close = (actual, expected, tol, what) => assert.ok(
  Math.abs(actual - expected) <= tol,
  `${what}: expected ~${expected}, got ${actual} (tolerance ${tol})`,
);

/* ── the perimeter formula against the geometry it claims to describe ────── */

test('perimeter formula matches the polygon it generates', () => {
  for (const [a, b, r] of [[200, 60, 30], [200, 60, 10], [120, 120, 0], [90, 40, 20]]) {
    const formula = 2 * (a + b) - 8 * r + 2 * Math.PI * r;
    const polygon = polylinePerimeter(roundedRectPoints(a, b, r, 256));
    // A polygon inscribed in the arcs is always slightly short; 256 segments a
    // corner puts that under a hundredth of a percent.
    close(polygon, formula, formula * 1e-4, `A${a} B${b} r${r}`);
  }
});

/* ── degenerate case 1: r = B/2 is a true obround ───────────────────────── */

test('r = B/2 gives a true obround', () => {
  const A = 200, B = 60, r = B / 2;
  assert.deepEqual(validate({ ...DEFAULTS, windowLength: A, windowWidth: B, cornerRadius: r }), [],
    'half the window width must be allowed — it is the normal product');

  const pts = roundedRectPoints(A, B, r, 256);
  // No straight run top or bottom: every point on the ends lies on one of the
  // two semicircles, so the extreme y is reached at exactly two x positions.
  const ys = pts.map((p) => p.y);
  close(Math.max(...ys), B / 2, 1e-9, 'top of the obround');
  close(Math.min(...ys), -B / 2, 1e-9, 'bottom of the obround');

  const centres = pts.filter((p) => Math.abs(p.y - B / 2) < 1e-9);
  assert.equal(centres.length, 2, 'a true obround touches its top edge at two points, not along a run');

  // Perimeter = two straights of (A − B) plus a full circle of diameter B.
  const expected = 2 * (A - B) + Math.PI * B;
  close(polylinePerimeter(pts), expected, expected * 1e-4, 'obround perimeter');
  close(derive({ ...DEFAULTS, windowLength: A, windowWidth: B, cornerRadius: r }).perimeter,
    expected, 1e-9, 'derived obround perimeter');
});

/* ── degenerate case 2: A = B with r = A/2 is a circular toroid ─────────── */

test('A = B with r = A/2 gives a circle', () => {
  const A = 120, r = A / 2;
  const params = { ...DEFAULTS, windowLength: A, windowWidth: A, cornerRadius: r };
  assert.deepEqual(validate(params), []);

  const pts = roundedRectPoints(A, A, r, 256);
  for (const p of pts) {
    close(Math.hypot(p.x, p.y), A / 2, 1e-9, 'every point sits on the circle');
  }
  close(derive(params).perimeter, Math.PI * A, 1e-9, 'circumference');

  // And the outer profile is the concentric circle a wound toroid really has.
  const d = derive(params);
  close(d.outerLength, A + 2 * DEFAULTS.build, 1e-9, 'outer diameter');
  close(d.outerCornerRadius, r + DEFAULTS.build, 1e-9, 'outer radius = inner + build');
});

/* ── validation ─────────────────────────────────────────────────────────── */

test('refuses a corner radius wider than half the window', () => {
  const errors = validate({ ...DEFAULTS, windowWidth: 60, cornerRadius: 31 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /corner radius/);
});

test('refuses non-positive dimensions, thickness and a stacking factor out of range', () => {
  assert.match(validate({ ...DEFAULTS, build: 0 })[0], /build/);
  assert.match(validate({ ...DEFAULTS, windowLength: -5 })[0], /window length/);
  assert.match(validate({ ...DEFAULTS, stripWidth: 0 })[0], /strip width/);
  assert.match(validate({ ...DEFAULTS, stripThickness: 0 })[0], /thickness/);
  assert.match(validate({ ...DEFAULTS, cornerRadius: -1 })[0], /negative/);
  assert.match(validate({ ...DEFAULTS, stackingFactor: 0.79 })[0], /stacking factor/);
  assert.match(validate({ ...DEFAULTS, stackingFactor: 1.01 })[0], /stacking factor/);
  assert.deepEqual(validate({ ...DEFAULTS, stackingFactor: 0.8 }), [], '0.8 is in range');
  assert.deepEqual(validate({ ...DEFAULTS, stackingFactor: 1 }), [], '1.0 is in range');
  assert.deepEqual(validate({ ...DEFAULTS, cornerRadius: 0 }), [], 'a sharp corner is allowed');
});

/* ── the derived figures, against arithmetic done by hand ───────────────── */

test('derived figures for a worked example', () => {
  const p = {
    windowLength: 200, windowWidth: 60, cornerRadius: 30, build: 40,
    stripWidth: 60, stripThickness: 0.27, stackingFactor: 0.96, density: 7.65,
  };
  const d = derive(p);
  close(d.perimeter, 520 - 240 + 2 * Math.PI * 30, 1e-9, 'P');
  close(d.meanPath, d.perimeter + Math.PI * 40, 1e-9, 'Lm');
  close(d.grossArea, 2400, 1e-9, 'Ag');
  close(d.netArea, 2304, 1e-9, 'Ae');
  close(d.volume, 2304 * d.meanPath, 1e-6, 'V');
  // g/cm³ is grams per 1000 mm³, so kilograms are V x rho / 1e6. Getting this
  // wrong by a factor of a thousand is the whole reason it is tested.
  close(d.weightKg, (2304 * d.meanPath * 7.65) / 1e6, 1e-9, 'W');
  close(d.weightKg, 10.47, 0.02, 'W is about ten and a half kilos');
  close(d.wraps, 40 / 0.27, 1e-9, 'N');
  close(d.stripLength, (40 * d.meanPath) / 0.27, 1e-6, 'strip length');
});

test('strip length equals the sum of every wrap, not an approximation of it', () => {
  const p = { ...DEFAULTS, build: 10, stripThickness: 0.5 };
  const n = p.build / p.stripThickness;
  // Each wrap's own perimeter, summed the long way round.
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const d = p.stripThickness * (i + 0.5);
    sum += derive({ ...p, build: 0 }).perimeter + 2 * Math.PI * d;
  }
  close(derive(p).stripLength, sum, sum * 1e-9, 'D x Lm / t is exact');
});

test('mean path sits between the inner and the outer perimeter', () => {
  const p = { ...DEFAULTS };
  const inner = derive({ ...p, build: 0 }).perimeter;
  const outer = inner + 2 * Math.PI * p.build;
  const mean = derive(p).meanPath;
  assert.ok(mean > inner && mean < outer, `${inner} < ${mean} < ${outer}`);
  close(mean, (inner + outer) / 2, 1e-9, 'exactly the average of the two');
});

test('weight scales with density, so a nickel alloy core is heavier than CRGO', () => {
  const crgo = derive({ ...DEFAULTS, density: 7.65 }).weightKg;
  const nickel = derive({ ...DEFAULTS, density: 8.7 }).weightKg;
  close(nickel / crgo, 8.7 / 7.65, 1e-12, 'ratio is exactly the density ratio');
  assert.ok(nickel > crgo);
});
