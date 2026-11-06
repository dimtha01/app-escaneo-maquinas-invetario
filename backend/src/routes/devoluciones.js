import { Router } from 'express';
import { getDb } from '../db/database.js';
import {
  getOrCreateSesionActiva,
  getSiguienteOrden,
} from '../db/sesiones.js';

const router = Router();

const listSql = `
  SELECT
    d.id,
    d.orden,
    d.sesion_id,
    d.codigo_escaneado,
    d.articulo AS Articulo,
    d.codigo_barra AS CodigoBarra,
    d.itemdesc AS ITEMDESC,
    d.cantidad AS Cantidad,
    d.udm AS UdM,
    d.notas,
    d.creado_en,
    d.sucursal_id,
    s.codigo AS sucursal_codigo,
    s.nombre AS sucursal_nombre,
    s.bahia,
    e.nombre AS estatus_nombre,
    e.codigo AS estatus_codigo,
    e.icono AS estatus_icono
  FROM devoluciones d
  JOIN sucursales s ON s.id = d.sucursal_id
  JOIN estatus_devolucion e ON e.id = d.estatus_id
`;

function buildFilters(query = {}) {
  const where = [];
  const params = {};

  if (query.hoy === '1' || query.hoy === 'true') {
    where.push(`date(d.creado_en) = date('now')`);
  }

  if (query.sesion_id) {
    where.push(`d.sesion_id = @sesion_id`);
    params.sesion_id = Number(query.sesion_id);
  }

  if (query.sucursal_id) {
    where.push(`d.sucursal_id = @sucursal_id`);
    params.sucursal_id = Number(query.sucursal_id);
  } else if (query.tienda) {
    where.push(`s.codigo = @tienda`);
    params.tienda = String(query.tienda).trim().toUpperCase();
  }

  if (query.q) {
    where.push(`(
      d.codigo_escaneado LIKE @q
      OR IFNULL(d.articulo, '') LIKE @q
      OR IFNULL(d.codigo_barra, '') LIKE @q
      OR IFNULL(d.itemdesc, '') LIKE @q
      OR IFNULL(s.codigo, '') LIKE @q
      OR IFNULL(s.nombre, '') LIKE @q
      OR IFNULL(e.nombre, '') LIKE @q
    )`);
    params.q = `%${String(query.q).trim()}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

router.get('/', (req, res) => {
  const db = getDb();
  const { whereSql, params } = buildFilters(req.query);
  const rows = db
    .prepare(
      `${listSql} ${whereSql}
       ORDER BY COALESCE(d.sesion_id, 0) DESC, COALESCE(d.orden, d.id) ASC
       LIMIT 500`
    )
    .all(params);
  res.json(rows);
});

router.get('/inventario', (req, res) => {
  const db = getDb();
  const { whereSql, params } = buildFilters(req.query);

  const items = db
    .prepare(
      `${listSql} ${whereSql}
       ORDER BY COALESCE(d.sesion_id, 0) DESC, COALESCE(d.orden, d.id) ASC
       LIMIT 1000`
    )
    .all(params);

  const totales = db
    .prepare(
      `SELECT
         COUNT(*) AS registros,
         COALESCE(SUM(d.cantidad), 0) AS cantidad
       FROM devoluciones d
       JOIN sucursales s ON s.id = d.sucursal_id
       JOIN estatus_devolucion e ON e.id = d.estatus_id
       ${whereSql}`
    )
    .get(params);

  res.json({
    items,
    totales: {
      registros: Number(totales.registros || 0),
      cantidad: Number(totales.cantidad || 0),
    },
  });
});

router.get('/hoy/count', (_req, res) => {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total
       FROM devoluciones
       WHERE date(creado_en) = date('now')`
    )
    .get();
  res.json({ total: row.total });
});

router.post('/', (req, res) => {
  const {
    codigo,
    producto_id,
    sucursal_id,
    estatus_id,
    notas,
    Articulo,
    CodigoBarra,
    ITEMDESC,
    Cantidad,
    UdM,
  } = req.body ?? {};

  if (!codigo || !sucursal_id || !estatus_id) {
    return res.status(400).json({
      error: 'codigo, sucursal_id y estatus_id son obligatorios',
    });
  }

  const db = getDb();
  const codigoEscaneado = String(codigo).trim();

  const producto =
    (producto_id
      ? db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(producto_id))
      : null) ||
    db
      .prepare(
        `SELECT * FROM productos
         WHERE codigo_barra = ? OR articulo = ?
         LIMIT 1`
      )
      .get(codigoEscaneado, codigoEscaneado);

  const sucursal = db
    .prepare('SELECT * FROM sucursales WHERE id = ? AND activo = 1')
    .get(Number(sucursal_id));
  const estatus = db
    .prepare('SELECT * FROM estatus_devolucion WHERE id = ? AND activo = 1')
    .get(Number(estatus_id));

  if (!sucursal) {
    return res.status(400).json({ error: 'Sucursal inválida' });
  }
  if (!estatus) {
    return res.status(400).json({ error: 'Estatus inválido' });
  }

  const articulo = String(Articulo ?? producto?.articulo ?? '').trim() || null;
  const codigoBarra =
    String(CodigoBarra ?? producto?.codigo_barra ?? codigoEscaneado).trim() || null;
  const itemdesc = String(ITEMDESC ?? producto?.itemdesc ?? '').trim() || null;
  const cantidad = Number(Cantidad ?? producto?.cantidad ?? 1);
  const udm = String(UdM ?? producto?.udm ?? 'UND').trim() || 'UND';

  const sesion = getOrCreateSesionActiva();
  const orden = getSiguienteOrden();

  const result = db
    .prepare(
      `INSERT INTO devoluciones
        (producto_id, codigo_escaneado, articulo, codigo_barra, itemdesc, cantidad, udm, sucursal_id, estatus_id, sesion_id, orden, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      producto?.id ?? null,
      codigoEscaneado,
      articulo,
      codigoBarra,
      itemdesc,
      Number.isFinite(cantidad) ? cantidad : 1,
      udm,
      sucursal.id,
      estatus.id,
      sesion.id,
      orden,
      notas ?? null
    );

  const devolucion = db
    .prepare(`${listSql} WHERE d.id = ?`)
    .get(result.lastInsertRowid);

  res.status(201).json({
    devolucion,
    orden,
    sesion_id: sesion.id,
    siguiente_orden: orden + 1,
    bahia: sucursal.bahia,
    mensaje: `#${orden} guardado en ${sucursal.nombre}.`,
  });
});

export default router;
