import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM sucursales WHERE activo = 1 ORDER BY codigo')
    .all();
  res.json(rows);
});

export default router;
