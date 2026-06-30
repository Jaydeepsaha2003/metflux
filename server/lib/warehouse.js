// Helpers for the Store / Warehouse stock layer.
//
// Generic stock pools by PHYSICAL SPEC, not by PO line — so overproduction from
// any order pools with identical goods. `specKey` is the stable signature used
// to group movements (Σ IN − Σ OUT) and to match stock against open SO lines.

const numKey = (n) => (n == null || n === '' ? '' : String(Number(n)));
const strKey = (s) => String(s ?? '').trim().toUpperCase();

// The physical-identity fields. weightPerPc is intentionally NOT part of the
// key (it's a measured value that can drift); dimensions + grade + material +
// measure + core type fully identify the part.
export const specKeyOf = (spec) => [
  strKey(spec.coreType),
  strKey(spec.grade),
  strKey(spec.material),
  strKey(spec.measure),
  numKey(spec.id1), numKey(spec.id2),
  numKey(spec.od1), numKey(spec.od2),
  numKey(spec.ht),
].join('|');

// Pull just the spec fields off a richer row (PoOrderItem or a stock movement).
export const pickSpec = (r) => ({
  coreType: r.coreType ?? null,
  grade: r.grade ?? null,
  material: r.material ?? null,
  measure: r.measure ?? null,
  id1: r.id1 ?? null, id2: r.id2 ?? null,
  od1: r.od1 ?? null, od2: r.od2 ?? null,
  ht: r.ht ?? null,
});
