#!/usr/bin/env node
/**
 * Rellena currcost (USD unitario CORP) en productos y devoluciones que lo tienen
 * en NULL / 0. Pensado para producción; probar primero con --dry-run.
 *
 * Uso (desde backend/):
 *   node scripts/backfill-currcost.js --dry-run
 *   node scripts/backfill-currcost.js
 *   SQLITE_PATH=/data/inventario.db node scripts/backfill-currcost.js --dry-run
 *
 * Requiere MSSQL_USER / MSSQL_PASSWORD (y red al linked CORP).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  buscarProductoCedis,
  isCedisConfigured,
} from '../src/db/cedis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || args.has('-n');
const verbose = args.has('--verbose') || args.has('-v');

function resolveDbPath() {
  const fromEnv = process.env.SQLITE_PATH || process.env.DB_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  const idx = process.argv.indexOf('--db');
  if (idx >= 0 && process.argv[idx + 1]) {
    return path.resolve(process.argv[idx + 1]);
  }
  return path.resolve(__dirname, '../data/inventario.db');
}

function missingCostSql(alias = '') {
  const col = alias ? `${alias}.currcost` : 'currcost';
  return `(${col} IS NULL OR ${col} = 0)`;
}

function candidatesFromDb(db) {
  const rows = db
    .prepare(
      `SELECT DISTINCT codigo FROM (
         SELECT TRIM(articulo) AS codigo FROM productos
           WHERE ${missingCostSql()} AND articulo IS NOT NULL AND TRIM(articulo) != ''
         UNION
         SELECT TRIM(codigo_barra) FROM productos
           WHERE ${missingCostSql()} AND codigo_barra IS NOT NULL AND TRIM(codigo_barra) != ''
         UNION
         SELECT TRIM(articulo) FROM devoluciones
           WHERE ${missingCostSql()} AND articulo IS NOT NULL AND TRIM(articulo) != ''
         UNION
         SELECT TRIM(codigo_barra) FROM devoluciones
           WHERE ${missingCostSql()} AND codigo_barra IS NOT NULL AND TRIM(codigo_barra) != ''
         UNION
         SELECT TRIM(codigo_escaneado) FROM devoluciones
           WHERE ${missingCostSql()} AND codigo_escaneado IS NOT NULL AND TRIM(codigo_escaneado) != ''
       )
       WHERE codigo IS NOT NULL AND codigo != ''
       ORDER BY codigo`
    )
    .all()
    .map((r) => String(r.codigo).trim())
    .filter(Boolean);
  return [...new Set(rows)];
}

async function lookupCost(codigo, cache) {
  if (cache.has(codigo)) return cache.get(codigo);
  let remoto = null;
  let error = null;
  try {
    remoto = await buscarProductoCedis(codigo);
  } catch (err) {
    error = err.message || String(err);
  }
  const cost = Number(remoto?.CurrCost ?? 0);
  const entry = {
    codigo,
    found: Boolean(remoto),
    articulo: remoto?.Articulo || null,
    codigoBarra: remoto?.CodigoBarra || null,
    currCost: Number.isFinite(cost) ? cost : 0,
    error,
  };
  cache.set(codigo, entry);
  // También cachea por articulo/barra encontrados para no repetir CORP
  if (entry.articulo) cache.set(entry.articulo, entry);
  if (entry.codigoBarra) cache.set(entry.codigoBarra, entry);
  return entry;
}

function applyUpdates(db, entry, { dryRun }) {
  if (!entry.found || !(entry.currCost > 0)) {
    return { productos: 0, devoluciones: 0 };
  }

  const keys = [...new Set([entry.codigo, entry.articulo, entry.codigoBarra].filter(Boolean))];
  const placeholders = keys.map(() => '?').join(', ');

  const countProd = db
    .prepare(
      `SELECT COUNT(*) AS c FROM productos
       WHERE ${missingCostSql()}
         AND (articulo IN (${placeholders}) OR codigo_barra IN (${placeholders}))`
    )
    .get(...keys, ...keys).c;

  const countDev = db
    .prepare(
      `SELECT COUNT(*) AS c FROM devoluciones
       WHERE ${missingCostSql()}
         AND (
           articulo IN (${placeholders})
           OR codigo_barra IN (${placeholders})
           OR codigo_escaneado IN (${placeholders})
         )`
    )
    .get(...keys, ...keys, ...keys).c;

  if (!dryRun && (countProd > 0 || countDev > 0)) {
    if (countProd > 0) {
      db.prepare(
        `UPDATE productos
         SET currcost = ?, actualizado_en = datetime('now')
         WHERE ${missingCostSql()}
           AND (articulo IN (${placeholders}) OR codigo_barra IN (${placeholders}))`
      ).run(entry.currCost, ...keys, ...keys);
    }
    if (countDev > 0) {
      db.prepare(
        `UPDATE devoluciones
         SET currcost = ?
         WHERE ${missingCostSql()}
           AND (
             articulo IN (${placeholders})
             OR codigo_barra IN (${placeholders})
             OR codigo_escaneado IN (${placeholders})
           )`
      ).run(entry.currCost, ...keys, ...keys, ...keys);
    }
  }

  return { productos: countProd, devoluciones: countDev };
}

async function main() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`[backfill-currcost] No existe la DB: ${dbPath}`);
    process.exit(1);
  }
  if (!isCedisConfigured()) {
    console.error(
      '[backfill-currcost] Faltan MSSQL_USER / MSSQL_PASSWORD en el entorno.'
    );
    process.exit(1);
  }

  console.log(`[backfill-currcost] DB: ${dbPath}`);
  console.log(
    `[backfill-currcost] Modo: ${dryRun ? 'DRY-RUN (no escribe)' : 'WRITE'}`
  );

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const beforeDev = db
    .prepare(
      `SELECT COUNT(*) AS c FROM devoluciones WHERE ${missingCostSql()}`
    )
    .get().c;
  const beforeProd = db
    .prepare(`SELECT COUNT(*) AS c FROM productos WHERE ${missingCostSql()}`)
    .get().c;

  const codes = candidatesFromDb(db);
  console.log(
    `[backfill-currcost] Sin costo: productos=${beforeProd} devoluciones=${beforeDev} códigos únicos=${codes.length}`
  );

  const cache = new Map();
  /** Evita re-aplicar el mismo artículo CORP si el código y la barra salen en la lista */
  const appliedArticulos = new Set();
  const summary = {
    lookedUp: 0,
    foundWithCost: 0,
    foundZero: 0,
    notFound: 0,
    errors: 0,
    productosUpdated: 0,
    devolucionesUpdated: 0,
  };

  for (const codigo of codes) {
    summary.lookedUp += 1;
    const entry = await lookupCost(codigo, cache);
    if (entry.error) {
      summary.errors += 1;
      console.warn(`  ! ${codigo}: error CORP — ${entry.error}`);
      continue;
    }
    if (!entry.found) {
      summary.notFound += 1;
      if (verbose) console.log(`  · ${codigo}: no encontrado en CORP`);
      continue;
    }
    if (!(entry.currCost > 0)) {
      summary.foundZero += 1;
      if (verbose) console.log(`  · ${codigo}: CORP CurrCost=0`);
      continue;
    }

    summary.foundWithCost += 1;
    const applyKey = entry.articulo || entry.codigoBarra || entry.codigo;
    if (appliedArticulos.has(applyKey)) {
      if (verbose) {
        console.log(`  · ${codigo}: ya aplicado vía ${applyKey}`);
      }
      continue;
    }
    appliedArticulos.add(applyKey);
    const updated = applyUpdates(db, entry, { dryRun });
    summary.productosUpdated += updated.productos;
    summary.devolucionesUpdated += updated.devoluciones;
    console.log(
      `  ✓ ${codigo} → ${entry.articulo} CurrCost=${entry.currCost}` +
        ` (prod ${updated.productos}, dev ${updated.devoluciones})` +
        (dryRun ? ' [dry-run]' : '')
    );
  }

  const afterDev = db
    .prepare(
      `SELECT COUNT(*) AS c FROM devoluciones WHERE ${missingCostSql()}`
    )
    .get().c;
  const afterProd = db
    .prepare(`SELECT COUNT(*) AS c FROM productos WHERE ${missingCostSql()}`)
    .get().c;

  console.log('[backfill-currcost] Resumen:', summary);
  console.log(
    `[backfill-currcost] Quedan sin costo: productos=${afterProd} devoluciones=${afterDev}`
  );

  db.close();
}

main().catch((err) => {
  console.error('[backfill-currcost] Falló:', err);
  process.exit(1);
});
