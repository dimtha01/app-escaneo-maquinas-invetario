import { getDb } from './database.js';

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

/** Una sola sesión permanente (sin terminar por ahora). */
export function getOrCreateSesionActiva() {
  const db = getDb();
  let sesion = getSesionActiva();
  if (sesion) return sesion;

  const result = db
    .prepare(`INSERT INTO sesiones_escaneo (activa) VALUES (1)`)
    .run();

  sesion = db
    .prepare(`SELECT * FROM sesiones_escaneo WHERE id = ?`)
    .get(result.lastInsertRowid);

  return sesion;
}

/** Orden correlativo global (una sola secuencia). */
export function getSiguienteOrden() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente
       FROM devoluciones`
    )
    .get();
  return Number(row?.siguiente || 1);
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
    siguiente_orden: Number(row?.ultimo_orden || 0) + 1,
  };
}

/** @deprecated Por ahora no se usan múltiples sesiones. */
export function getResumenSesion(_sesionId) {
  return getResumenOrden();
}

/** @deprecated Por ahora no se terminan sesiones. */
export function terminarSesionActiva() {
  return {
    ok: false,
    terminada: false,
    message: 'Por ahora solo hay una secuencia continua; no se termina la sesión.',
  };
}
