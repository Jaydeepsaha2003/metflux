// Let existing grades be used for cut cores.
//
// A grade's `coreTypes` is the gate: the order form only offers a grade for a
// family that grade names. Every grade in the database predates the cut cores,
// so none of them name CUT_ROUND or CUT_RECT — which means the Round cut and
// Rect cut tabs open onto an empty "Select grade…" until somebody ticks the new
// boxes on Settings → Materials, grade by grade.
//
// This does that in one pass, on the only rule that makes physical sense: a cut
// core is cut FROM a wound core, so a grade you can wind a toroid from is a
// grade you can cut a round core from, and likewise rectangular to C core. A
// grade that names neither parent family is left alone.
//
// DELIBERATELY NOT IN THE `migrate` CHAIN. Which grades your works will actually
// cut is a commercial decision, not something a deploy should make on your
// behalf, and the Materials screen can now tick and untick these by hand. Run it
// only if you want the whole catalogue opened up at once:
//
//   npm --workspace server run migrate:cut-core-grades
//
// Idempotent, and it only ever ADDS a family — nothing is taken away.
import 'dotenv/config';
import { pool } from '../lib/db.js';

/** parent family → the cut family it can be cut into. */
const DERIVED = [
  ['TOROIDAL', 'CUT_ROUND'],
  ['RECTANGULAR', 'CUT_RECT'],
];

const main = async () => {
  const [rows] = await pool.query(
    'SELECT `id`, `companyId`, `grade`, `coreTypes` FROM `MaterialGrade`'
  );

  let changed = 0;
  let untouched = 0;

  for (const row of rows) {
    const current = String(row.coreTypes ?? '')
      .split(',').map((v) => v.trim()).filter(Boolean);

    // An empty list already means "every family" to the order form, so there is
    // nothing to open up and writing a list here would narrow it.
    if (current.length === 0) { untouched += 1; continue; }

    const next = [...current];
    for (const [parent, cut] of DERIVED) {
      if (next.includes(parent) && !next.includes(cut)) next.push(cut);
    }

    if (next.length === current.length) { untouched += 1; continue; }

    await pool.query(
      'UPDATE `MaterialGrade` SET `coreTypes` = ? WHERE `id` = ?',
      [next.join(','), row.id]
    );
    console.log(`[migrate] ${row.grade}: ${current.join(',')} -> ${next.join(',')}`);
    changed += 1;
  }

  console.log(`[migrate] Cut-core grades: ${changed} opened up, ${untouched} already fine.`);
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
