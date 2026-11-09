import { getDb } from './database.js';

/**
 * Orden correlativo compartido (1,2,3…).
 * Si se elimina un número (ej. #2), el próximo registro reutiliza ese hueco.
 */

export function getSesionActiva() {
  const db = getDb();
  return db
    .prepare(
      `SELECT *
       FROM sesiones_escaneo
       WHERE activa = 1
       ORDER BY id DESC
       LIMIT 1`
    )
    .get();
}

export function getOrCreateSesionActiva() {
  const db = getDb();
  let sesion = getSesionActiva();
  if (sesion) return sesion;

  const result = db
    .prepare(`INSERT INTO sesiones_escaneo (activa) VALUES (1)`)
    .run();

  return db
    .prepare(`SELECT * FROM sesiones_escaneo WHERE id = ?`)
    .get(result.lastInsertRowid);
}

/** Primer hueco libre (o max+1). Ej: [1,3] → 2. */
export function getSiguienteOrden() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT orden
       FROM devoluciones
       WHERE orden IS NOT NULL
       ORDER BY orden ASC`
    )
    .all();

  let expected = 1;
  for (const row of rows) {
    const n = Number(row.orden);
    if (!Number.isFinite(n) || n < expected) continue;
    if (n === expected) {
      expected += 1;
      continue;
    }
    // Hueco encontrado
    break;
  }
  return expected;
}

export function getResumenOrden() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(MAX(orden), 0) AS ultimo_orden
       FROM devoluciones`
    )
    .get();

  return {
    total: Number(row?.total || 0),
    ultimo_orden: Number(row?.ultimo_orden || 0),
    siguiente_orden: getSiguienteOrden(),
  };
}

export function getResumenSesion(_sesionId) {
  return getResumenOrden();
}

export function terminarSesionActiva() {
  return {
    ok: false,
    terminada: false,
    message: 'No hay sesiones: el orden es compartido y reutiliza huecos.',
  };
}
