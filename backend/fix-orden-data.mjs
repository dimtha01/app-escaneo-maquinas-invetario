/**
 * Corrige datos anómalos del inventario:
 * - fecha/hora del #400 (reloj del servidor iba atrasado)
 * - contador_orden desfasado
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'data/inventario.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

const bad = db
  .prepare(
    `SELECT id, orden, creado_en
     FROM devoluciones
     WHERE orden = 400`
  )
  .get();

const prev = db
  .prepare(
    `SELECT id, orden, creado_en
     FROM devoluciones
     WHERE orden = 399`
  )
  .get();

console.log('Antes #399:', prev);
console.log('Antes #400:', bad);

if (bad && prev) {
  // Si #400 quedó con hora anterior a #399, lo reubicamos 1s después de #399.
  if (String(bad.creado_en) < String(prev.creado_en)) {
    const fixed = db
      .prepare(
        `UPDATE devoluciones
         SET creado_en = datetime(?, '+1 second')
         WHERE id = ?`
      )
      .run(prev.creado_en, bad.id);
    console.log('Fecha #400 corregida. changes=', fixed.changes);
  } else {
    console.log('Fecha #400 ya es coherente; no se toca.');
  }
}

const gap = db
  .prepare(
    `SELECT COALESCE(MIN(t.orden), 0) + 1 AS siguiente
     FROM (
       SELECT orden FROM devoluciones WHERE orden IS NOT NULL
       UNION ALL
       SELECT 0
     ) t
     WHERE NOT EXISTS (
       SELECT 1 FROM devoluciones d WHERE d.orden = t.orden + 1
     )`
  )
  .get();

const siguiente = Number(gap?.siguiente) > 0 ? Number(gap.siguiente) : 1;
db.prepare(
  `INSERT INTO contador_orden (id, siguiente) VALUES (1, ?)
   ON CONFLICT(id) DO UPDATE SET siguiente = excluded.siguiente`
).run(siguiente);

console.log('contador_orden.siguiente =', siguiente);
console.log(
  'Después #400:',
  db.prepare(`SELECT id, orden, creado_en FROM devoluciones WHERE orden = 400`).get()
);
console.log(
  'Últimos:',
  db
    .prepare(
      `SELECT id, orden, creado_en FROM devoluciones ORDER BY orden DESC LIMIT 8`
    )
    .all()
);

db.close();
console.log('OK');
