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
    d.estatus_id,
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
  // Hoy: último → primero; resto: primero → último
  const ordenDir =
    req.query.hoy === '1' || req.query.hoy === 'true' ? 'DESC' : 'ASC';
  const rows = db
    .prepare(
      `${listSql} ${whereSql}
       ORDER BY COALESCE(d.sesion_id, 0) DESC, COALESCE(d.orden, d.id) ${ordenDir}
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

  // Orden correlativo: rellena huecos (si borras #2, el próximo usa #2).
  const insertConOrden = db.transaction(() => {
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
    return { orden, id: Number(result.lastInsertRowid) };
  });

  let created;
  try {
    created = insertConOrden();
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE')) {
      created = insertConOrden();
    } else {
      throw err;
    }
  }

  const { orden, id } = created;

  const devolucion = db.prepare(`${listSql} WHERE d.id = ?`).get(id);

  res.status(201).json({
    devolucion,
    orden,
    sesion_id: sesion.id,
    siguiente_orden: getSiguienteOrden(),
    bahia: sucursal.bahia,
    mensaje: `#${orden} guardado en ${sucursal.nombre}.`,
  });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT * FROM devoluciones WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Registro no encontrado' });
  }

  const body = req.body ?? {};
  let sucursalId = existing.sucursal_id;
  let estatusId = existing.estatus_id;
  let cantidad = existing.cantidad;
  let notas = existing.notas;
  let itemdesc = existing.itemdesc;
  let codigoEscaneado = existing.codigo_escaneado;
  let codigoBarra = existing.codigo_barra;
  let articulo = existing.articulo;
  let udm = existing.udm;

  if (body.codigo !== undefined || body.CodigoBarra !== undefined || body.codigo_barra !== undefined) {
    const codigo = String(
      body.codigo ?? body.CodigoBarra ?? body.codigo_barra ?? ''
    ).trim();
    if (!codigo) {
      return res.status(400).json({ error: 'Código inválido' });
    }
    codigoEscaneado = codigo;
    codigoBarra = codigo;
  }

  if (body.Articulo !== undefined || body.articulo !== undefined) {
    articulo = String(body.Articulo ?? body.articulo ?? '').trim() || null;
  }
  if (body.UdM !== undefined || body.udm !== undefined) {
    udm = String(body.UdM ?? body.udm ?? '').trim() || 'UND';
  }

  if (body.sucursal_id !== undefined) {
    const sucursal = db
      .prepare('SELECT * FROM sucursales WHERE id = ? AND activo = 1')
      .get(Number(body.sucursal_id));
    if (!sucursal) {
      return res.status(400).json({ error: 'Sucursal inválida' });
    }
    sucursalId = sucursal.id;
  }

  if (body.estatus_id !== undefined) {
    const estatus = db
      .prepare('SELECT * FROM estatus_devolucion WHERE id = ? AND activo = 1')
      .get(Number(body.estatus_id));
    if (!estatus) {
      return res.status(400).json({ error: 'Estatus inválido' });
    }
    estatusId = estatus.id;
  }

  if (body.Cantidad !== undefined || body.cantidad !== undefined) {
    const n = Number(body.Cantidad ?? body.cantidad);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }
    cantidad = n;
  }

  if (body.notas !== undefined) {
    const text = String(body.notas ?? '').trim();
    notas = text || null;
  }

  if (body.ITEMDESC !== undefined || body.itemdesc !== undefined) {
    const text = String(body.ITEMDESC ?? body.itemdesc ?? '').trim();
    itemdesc = text || null;
  }

  db.prepare(
    `UPDATE devoluciones
     SET codigo_escaneado = ?, codigo_barra = ?, articulo = ?, itemdesc = ?, cantidad = ?, udm = ?, sucursal_id = ?, estatus_id = ?, notas = ?
     WHERE id = ?`
  ).run(
    codigoEscaneado,
    codigoBarra,
    articulo,
    itemdesc,
    cantidad,
    udm,
    sucursalId,
    estatusId,
    notas,
    id
  );

  const devolucion = db.prepare(`${listSql} WHERE d.id = ?`).get(id);
  res.json({
    ok: true,
    devolucion,
    mensaje: `Actualizado #${devolucion.orden ?? id}.`,
  });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }

  const db = getDb();
  const existing = db
    .prepare(`${listSql} WHERE d.id = ?`)
    .get(id);

  if (!existing) {
    return res.status(404).json({ error: 'Registro no encontrado' });
  }

  db.prepare(`DELETE FROM devoluciones WHERE id = ?`).run(id);

  res.json({
    ok: true,
    id,
    orden: existing.orden,
    mensaje: `Eliminado #${existing.orden ?? id}.`,
    siguiente_orden: getSiguienteOrden(),
  });
});

export default router;
