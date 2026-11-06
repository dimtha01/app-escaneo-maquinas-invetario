import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM estatus_devolucion WHERE activo = 1 ORDER BY id')
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { nombre, icono } = req.body ?? {};

  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'nombre es obligatorio' });
  }

  const cleanName = String(nombre).trim();
  const codigo = cleanName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || `estatus_${Date.now()}`;

  try {
    const result = getDb()
      .prepare(
        `INSERT INTO estatus_devolucion (codigo, nombre, icono)
         VALUES (?, ?, ?)`
      )
      .run(codigo, cleanName, icono ?? 'label');

    const row = getDb()
      .prepare('SELECT * FROM estatus_devolucion WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un estatus con ese nombre/código' });
    }
    throw err;
  }
});

export default router;
