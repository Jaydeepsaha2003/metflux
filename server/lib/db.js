// MySQL connection pool + query helpers — replaces Prisma client.
//
// Why we dropped Prisma: the Rust query engine (both library and binary
// modes) panics with "PANIC: timer has gone away" on Hostinger's LiteSpeed/
// lsnode wrapper because Hostinger restricts the background futures-timer
// threads the Rust engine relies on. This is documented but cannot be
// fixed from our side.
//
// Public API:
//   - pool:   the mysql2/promise pool (use directly for advanced needs)
//   - newId:  generate a string id for a new row (uuid v4)
//   - q:      run a query, return all rows
//   - qOne:   run a query, return the first row (or null)
//   - insert: insert one row, auto-generates id + updatedAt; returns the row
//   - update: update one row by id, auto-bumps updatedAt; returns the row
//   - del:    delete one row by id
//   - txn:    run a callback inside a SQL transaction with auto-rollback
//
// Backwards-compat: a stub `prisma` export exists so routes that still
// import `prisma` from this file can load at boot. Any method call on the
// stub throws a clear "not yet migrated" error — the *server* boots fine
// and any migrated route works; only unmigrated routes return 501.
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { env } from './env.js';

export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: 5,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

// Convert JS values into mysql2-friendly bind params:
// undefined → null, plain objects/arrays → JSON-stringified, Date → as-is.
const prep = (v) => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
};

export const newId = () => uuidv4();

// Tables that have an `updatedAt` column (Prisma's @updatedAt). Insert/update
// helpers below auto-fill this column for these tables only — passing it for
// any other table would produce `Unknown column 'updatedAt' in 'field list'`
// and roll the whole transaction back. Keep this list in sync with
// database.sql / the Prisma schema. Join / item tables intentionally omitted.
const TABLES_WITH_UPDATED_AT = new Set([
  'Company',
  'User',
  'Membership',
  'Customer',
  'FluxGrade',
  'PoOrder',
  'Production',
  'Dispatch',
  'PackingList',
  'Labour',
  'Supplier',
  'SupplierOrder',
  'WorkAllotment',
  'Return',
  'ContactSubmission',
  'SalesInvoice',
  'Payment',
  'PurchaseInvoice',
  'SupplierPayment',
]);

const pickConn = (override) => override ?? pool;

export const q = async (sql, params = [], overrideConn = null) => {
  const c = pickConn(overrideConn);
  const [rows] = await c.query(sql, (params || []).map(prep));
  return rows;
};

export const qOne = async (sql, params = [], overrideConn = null) => {
  const rows = await q(sql, params, overrideConn);
  return rows[0] ?? null;
};

export const insert = async (table, data, overrideConn = null) => {
  const c = pickConn(overrideConn);
  const id = data.id ?? newId();
  const row = { id, ...data };
  // Auto-fill updatedAt only for tables that actually have the column. Doing
  // it unconditionally was silently breaking inserts into join / item tables
  // like LabourMembership, PoOrderItem, ReturnItem, etc. — MySQL would throw
  // "Unknown column 'updatedAt'" and the surrounding transaction would roll
  // back, making the whole save look like a no-op.
  if (TABLES_WITH_UPDATED_AT.has(table) && row.updatedAt === undefined) {
    row.updatedAt = new Date();
  } else if (!TABLES_WITH_UPDATED_AT.has(table)) {
    // Defensive: strip a caller-provided updatedAt for tables that don't
    // have one, so a typo or stale code can't poison the query.
    delete row.updatedAt;
  }
  const keys = Object.keys(row);
  const cols = keys.map((k) => `\`${k}\``).join(',');
  const placeholders = keys.map(() => '?').join(',');
  const vals = keys.map((k) => prep(row[k]));
  await c.query(`INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`, vals);
  const [fresh] = await c.query(`SELECT * FROM \`${table}\` WHERE \`id\` = ?`, [id]);
  return fresh[0] ?? null;
};

export const update = async (table, id, data, overrideConn = null) => {
  const c = pickConn(overrideConn);
  const row = { ...data };
  // Same guard as insert: only bump updatedAt on tables that have it.
  if (TABLES_WITH_UPDATED_AT.has(table)) {
    row.updatedAt = new Date();
  } else {
    delete row.updatedAt;
  }
  const keys = Object.keys(row);
  if (keys.length === 0) {
    const [fresh] = await c.query(`SELECT * FROM \`${table}\` WHERE \`id\` = ?`, [id]);
    return fresh[0] ?? null;
  }
  const sets = keys.map((k) => `\`${k}\` = ?`).join(',');
  const vals = keys.map((k) => prep(row[k]));
  await c.query(`UPDATE \`${table}\` SET ${sets} WHERE \`id\` = ?`, [...vals, id]);
  const [fresh] = await c.query(`SELECT * FROM \`${table}\` WHERE \`id\` = ?`, [id]);
  return fresh[0] ?? null;
};

export const del = async (table, id, overrideConn = null) => {
  const c = pickConn(overrideConn);
  await c.query(`DELETE FROM \`${table}\` WHERE \`id\` = ?`, [id]);
};

// Run a callback inside a SQL transaction. The callback receives an object
// with q / qOne / insert / update / del all bound to the open transaction
// connection — so anything inside the callback either all commits or all
// rolls back together.
export const txn = async (fn) => {
  const tx = await pool.getConnection();
  try {
    await tx.beginTransaction();
    const helpers = {
      q:      (sql, params)         => q(sql, params, tx),
      qOne:   (sql, params)         => qOne(sql, params, tx),
      insert: (table, data)         => insert(table, data, tx),
      update: (table, id, data)     => update(table, id, data, tx),
      del:    (table, id)           => del(table, id, tx),
    };
    const result = await fn(helpers);
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch { /* swallow — we already have a real error */ }
    throw e;
  } finally {
    tx.release();
  }
};

/* ---------- Prisma compatibility stub ----------
   Routes that still `import { prisma } from '../lib/db.js'` can load
   without crashing the server. Any `prisma.X.Y(...)` call throws a clear
   migration error so the failure mode is obvious during development. */
const prismaStubModel = (modelName) =>
  new Proxy({}, {
    get(_target, method) {
      return () => {
        const err = new Error(
          `prisma.${modelName}.${String(method)}() — this route has not been migrated ` +
          `from Prisma to mysql2 yet. Migrate it using the helpers in server/lib/db.js ` +
          `(q, qOne, insert, update, del, txn).`
        );
        err.code = 'PRISMA_NOT_MIGRATED';
        err.status = 501;
        throw err;
      };
    },
  });

export const prisma = new Proxy(
  {
    $disconnect: () => pool.end(),
    $connect:    async () => { /* mysql2 pool opens connections lazily */ },
    $transaction: () => {
      throw new Error('prisma.$transaction() — use txn() from lib/db.js instead');
    },
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return prismaStubModel(String(prop));
    },
  }
);
