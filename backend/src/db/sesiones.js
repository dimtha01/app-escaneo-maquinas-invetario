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
  // Una sola query: el menor entero >= 1 que no exista en orden.
  const row = db
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

  const n = Number(row?.siguiente);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Sincroniza contador_orden con el próximo hueco/max+1. */
export function syncContadorOrden() {
  const db = getDb();
  const siguiente = getSiguienteOrden();
  db.prepare(
    `INSERT INTO contador_orden (id, siguiente) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET siguiente = excluded.siguiente`
  ).run(siguiente);
  return siguiente;
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
