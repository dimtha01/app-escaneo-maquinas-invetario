import { getDb } from './database.js';

/**
 * Orden autoincremental global (= id de devoluciones).
 * Todos los dispositivos comparten la misma secuencia en el mismo backend.
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

/** Próximo orden autoincremental (siguiente id). */
export function getSiguienteOrden() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(id), 0) + 1 AS siguiente
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
         COALESCE(MAX(id), 0) AS ultimo_orden
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
    message: 'No hay sesiones: el orden es autoincremental y compartido.',
  };
}
