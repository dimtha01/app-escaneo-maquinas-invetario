import { Router } from 'express';
import { getDb, toCedisProducto } from '../db/database.js';
import { buscarProductoCedis, isCedisConfigured } from '../db/cedis.js';

const router = Router();

function normalizePayload(body = {}) {
  const articulo = String(body.Articulo ?? body.articulo ?? '').trim();
  const codigoBarra = String(
    body.CodigoBarra ?? body.codigo_barra ?? body.codigo ?? ''
  ).trim();
  const itemdesc = String(body.ITEMDESC ?? body.itemdesc ?? body.nombre ?? '').trim();
  const cantidad = Number(body.Cantidad ?? body.cantidad ?? 1);
  const udm = String(body.UdM ?? body.udm ?? 'UND').trim() || 'UND';
  const currcost = Number(body.CurrCost ?? body.currcost ?? 0);
  return {
    articulo,
    codigoBarra,
    itemdesc,
    cantidad,
    udm,
    currcost: Number.isFinite(currcost) ? currcost : 0,
  };
}

function upsertProductoLocal(cedis) {
  const db = getDb();
  const costo = Number(cedis.CurrCost ?? 0);
  const existing = db
    .prepare(
      `SELECT * FROM productos
       WHERE codigo_barra = ? OR articulo = ?
       LIMIT 1`
    )
    .get(cedis.CodigoBarra, cedis.Articulo);

  if (existing) {
    db.prepare(
      `UPDATE productos
       SET articulo = ?,
           codigo_barra = ?,
           itemdesc = ?,
           cantidad = ?,
           udm = ?,
           currcost = ?,
           actualizado_en = datetime('now')
       WHERE id = ?`
    ).run(
      cedis.Articulo,
      cedis.CodigoBarra,
      cedis.ITEMDESC,
      cedis.Cantidad,
      cedis.UdM,
      Number.isFinite(costo) ? costo : 0,
      existing.id
    );
    return db.prepare('SELECT * FROM productos WHERE id = ?').get(existing.id);
  }

  const result = db
    .prepare(
      `INSERT INTO productos (articulo, codigo_barra, itemdesc, cantidad, udm, currcost)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      cedis.Articulo,
      cedis.CodigoBarra,
      cedis.ITEMDESC,
      cedis.Cantidad,
      cedis.UdM,
      Number.isFinite(costo) ? costo : 0
    );

  return db.prepare('SELECT * FROM productos WHERE id = ?').get(result.lastInsertRowid);
}

router.get('/', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM productos ORDER BY id DESC')
    .all()
    .map(toCedisProducto);
  res.json(rows);
});

router.get('/buscar/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo ?? '').trim();
  if (!codigo) {
    return res.status(400).json({ error: 'codigo es obligatorio' });
  }

  // 1) CEDIS (SQL Server) — fuente de verdad
  if (isCedisConfigured()) {
    try {
      const remoto = await buscarProductoCedis(codigo);
      if (remoto) {
        const local = upsertProductoLocal(remoto);
        return res.json({
          ...toCedisProducto(local),
          fuente: 'cedis',
        });
      }
    } catch (err) {
      // Si CEDIS falla, cae a SQLite local
      console.error('[CEDIS] buscar error:', err.message);
    }
  }

  // 2) Fallback SQLite local
  const row = getDb()
    .prepare(
      `SELECT * FROM productos
       WHERE codigo_barra = ? OR articulo = ?
       LIMIT 1`
    )
    .get(codigo, codigo);

  if (!row) {
    return res.status(404).json({ error: 'Producto no encontrado', codigo });
  }

  res.json({
    ...toCedisProducto(row),
    fuente: 'sqlite',
  });
});

router.post('/', (req, res) => {
  const { articulo, codigoBarra, itemdesc, cantidad, udm, currcost } =
    normalizePayload(req.body);

  if (!articulo || !codigoBarra || !itemdesc) {
    return res.status(400).json({
      error: 'Articulo, CodigoBarra e ITEMDESC son obligatorios',
    });
  }

  try {
    const result = getDb()
      .prepare(
        `INSERT INTO productos (articulo, codigo_barra, itemdesc, cantidad, udm, currcost)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        articulo,
        codigoBarra,
        itemdesc,
        Number.isFinite(cantidad) ? cantidad : 1,
        udm,
        Number.isFinite(currcost) ? currcost : 0
      );

    const row = getDb()
      .prepare('SELECT * FROM productos WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(toCedisProducto(row));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un producto con ese CodigoBarra' });
    }
    throw err;
  }
});

export default router;
