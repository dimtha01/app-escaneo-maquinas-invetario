import { Router } from 'express';
import {
  getOrCreateSesionActiva,
  getResumenOrden,
  getSiguienteOrden,
} from '../db/sesiones.js';

const router = Router();

router.get('/activa', (_req, res) => {
  const sesion = getOrCreateSesionActiva();
  const resumen = getResumenOrden();
  res.json({
    activa: true,
    sesion,
    siguiente_orden: resumen.siguiente_orden,
    total: resumen.total,
    ultimo_orden: resumen.ultimo_orden,
  });
});

router.post('/iniciar', (_req, res) => {
  const sesion = getOrCreateSesionActiva();
  const resumen = getResumenOrden();
  res.json({
    ok: true,
    creada: false,
    sesion,
    siguiente_orden: resumen.siguiente_orden,
    total: resumen.total,
    ultimo_orden: resumen.ultimo_orden,
  });
});

router.post('/terminar', (_req, res) => {
  res.status(400).json({
    ok: false,
    terminada: false,
    message: 'Por ahora solo hay una secuencia; no se termina sesión.',
    siguiente_orden: getSiguienteOrden(),
  });
});

export default router;
