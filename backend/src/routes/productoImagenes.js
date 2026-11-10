import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { getDb, getProductoImagenesDir } from '../db/database.js';
import { enhanceProductImage, isBflConfigured } from '../services/bflEnhance.js';
import {
  buildProductQuery,
  downloadImageToDir,
  isApifyConfigured,
  searchGoogleImagesBatch,
} from '../services/apifyGoogleImages.js';

const router = Router();
const imagenesDir = getProductoImagenesDir();
/** Evita enhance concurrente del mismo código (doble click / requests colgados). */
const enhanceInFlight = new Set();
/** Job en memoria para búsqueda Google masiva. */
let googleJob = null;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function normalizeCodigo(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^\w.-]+/g, '_');
}

function routeLog(_hypothesisId, _location, message, data = {}) {
  console.log(`[IMG] ${message}${Object.keys(data).length ? ` ${JSON.stringify(data)}` : ''}`);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, imagenesDir),
  filename: (req, file, cb) => {
    const codigo = normalizeCodigo(req.params.codigo);
    const ext =
      file.mimetype === 'image/png'
        ? '.png'
        : file.mimetype === 'image/webp'
          ? '.webp'
          : file.mimetype === 'image/gif'
            ? '.gif'
            : '.jpg';
    cb(null, `${codigo}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Solo se permiten imágenes JPG, PNG, WEBP o GIF'));
      return;
    }
    cb(null, true);
  },
});

router.get('/status', (_req, res) => {
  res.json({
    bflConfigured: isBflConfigured(),
    apifyConfigured: isApifyConfigured(),
    enhanceDefault: true,
    provider: 'Black Forest Labs',
    googleProvider: 'Apify · hooli/google-images-scraper',
  });
});

router.get('/buscar-google/job', (_req, res) => {
  res.json(googleJob || { status: 'idle' });
});

/**
 * Busca en Google Images (Apify) para todos los productos (o solo sin imagen)
 * y opcionalmente descarga la 1ª foto como imagen del producto.
 */
router.post('/buscar-google', async (req, res) => {
  if (!isApifyConfigured()) {
    return res.status(400).json({
      error:
        'Falta APIFY_TOKEN. Agrégala en backend/.env (Apify Console → Integrations).',
    });
  }
  if (googleJob?.status === 'running') {
    return res.status(409).json({
      error: 'Ya hay una búsqueda Google en curso',
      job: googleJob,
    });
  }

  const soloSinImagen = req.body?.soloSinImagen !== false;
  const maxPorProducto = Math.min(Math.max(Number(req.body?.maxPorProducto) || 5, 1), 10);
  const aplicarPrimera = req.body?.aplicarPrimera !== false;
  const qFilter = String(req.body?.q || '').trim();

  const db = getDb();
  const params = {};
  let whereExtra = '';
  if (qFilter) {
    whereExtra = `AND (
      IFNULL(d.articulo, '') LIKE @q
      OR IFNULL(d.codigo_barra, '') LIKE @q
      OR IFNULL(d.itemdesc, '') LIKE @q
      OR IFNULL(d.codigo_escaneado, '') LIKE @q
    )`;
    params.q = `%${qFilter}%`;
  }

  const rows = db
    .prepare(
      `SELECT
         TRIM(COALESCE(NULLIF(d.articulo, ''), NULLIF(d.codigo_barra, ''), d.codigo_escaneado)) AS codigo,
         MAX(IFNULL(d.itemdesc, '')) AS descripcion,
         MAX(IFNULL(d.codigo_barra, d.codigo_escaneado)) AS codigo_barra
       FROM devoluciones d
       WHERE TRIM(COALESCE(NULLIF(d.articulo, ''), NULLIF(d.codigo_barra, ''), d.codigo_escaneado)) != ''
       ${whereExtra}
       GROUP BY TRIM(COALESCE(NULLIF(d.articulo, ''), NULLIF(d.codigo_barra, ''), d.codigo_escaneado))
       ORDER BY MIN(COALESCE(d.orden, d.id)) ASC`
    )
    .all(params);

  const imgCodigos = new Set(
    db.prepare(`SELECT codigo FROM producto_imagenes`).all().map((r) => String(r.codigo))
  );

  let productos = rows.map((r) => ({
    codigo: String(r.codigo),
    descripcion: r.descripcion || '',
    codigoBarra: r.codigo_barra || '',
    tieneImagen: imgCodigos.has(String(r.codigo)),
  }));
  if (soloSinImagen) productos = productos.filter((p) => !p.tieneImagen);

  if (!productos.length) {
    return res.json({
      ok: true,
      status: 'idle',
      message: soloSinImagen
        ? 'No hay productos sin imagen para buscar'
        : 'No hay productos',
      totales: { productos: 0 },
    });
  }

  const jobId = `gimg-${Date.now()}`;
  googleJob = {
    id: jobId,
    status: 'running',
    startedAt: new Date().toISOString(),
    totales: {
      productos: productos.length,
      conResultados: 0,
      aplicadas: 0,
      errores: 0,
    },
    items: productos.map((p) => ({
      codigo: p.codigo,
      status: 'pending',
      query: null,
      candidates: 0,
      applied: false,
      error: null,
    })),
    error: null,
  };

  res.json({ ok: true, jobId, status: 'running', totales: googleJob.totales });

  // Ejecuta en background (la respuesta HTTP ya salió).
  (async () => {
    try {
      const queryByCodigo = new Map();
      const queries = [];
      for (const p of productos) {
        const query = buildProductQuery(p);
        queryByCodigo.set(p.codigo, query);
        queries.push(query);
        const row = googleJob.items.find((i) => i.codigo === p.codigo);
        if (row) {
          row.query = query;
          row.status = 'searching';
        }
      }

      const byQuery = await searchGoogleImagesBatch(queries, {
        maxResultsPerQuery: maxPorProducto,
      });

      for (const p of productos) {
        const itemState = googleJob.items.find((i) => i.codigo === p.codigo);
        const query = queryByCodigo.get(p.codigo);
        const candidates = byQuery.get(query) || [];
        if (itemState) {
          itemState.candidates = candidates.length;
          itemState.status = candidates.length ? 'found' : 'empty';
        }

        // Guarda candidatas para elegir después
        try {
          const candPath = path.join(
            imagenesDir,
            `${normalizeCodigo(p.codigo)}.google.json`
          );
          fs.writeFileSync(
            candPath,
            JSON.stringify(
              {
                codigo: p.codigo,
                query,
                updatedAt: new Date().toISOString(),
                candidates,
              },
              null,
              2
            )
          );
        } catch {
          /* ignore */
        }

        if (!candidates.length) continue;
        googleJob.totales.conResultados += 1;

        if (!aplicarPrimera) continue;
        if (p.tieneImagen) continue;

        try {
          const first = candidates[0];
          const saved = await downloadImageToDir(
            first.imageUrl,
            imagenesDir,
            normalizeCodigo(p.codigo)
          );
          // limpia archivo previo con otra extensión
          const prev = db
            .prepare(`SELECT filename FROM producto_imagenes WHERE codigo = ?`)
            .get(p.codigo);
          if (prev?.filename && prev.filename !== saved.filename) {
            unlinkQuiet(path.join(imagenesDir, prev.filename));
          }
          db.prepare(
            `INSERT INTO producto_imagenes (codigo, filename, mime, original_name, actualizado_en)
             VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
             ON CONFLICT(codigo) DO UPDATE SET
               filename = excluded.filename,
               mime = excluded.mime,
               original_name = excluded.original_name,
               actualizado_en = excluded.actualizado_en`
          ).run(p.codigo, saved.filename, saved.mime, `google:${first.imageUrl.slice(0, 180)}`);
          googleJob.totales.aplicadas += 1;
          if (itemState) {
            itemState.applied = true;
            itemState.status = 'applied';
          }
          console.log(`[IMG] google applied ${p.codigo} bytes=${saved.bytes}`);
        } catch (err) {
          googleJob.totales.errores += 1;
          if (itemState) {
            itemState.status = 'error';
            itemState.error = err.message || String(err);
          }
          console.log(`[IMG] google apply fail ${p.codigo}: ${err.message || err}`);
        }
      }

      googleJob.status = 'done';
      googleJob.finishedAt = new Date().toISOString();
      console.log(`[IMG] google job done ${JSON.stringify(googleJob.totales)}`);
    } catch (err) {
      googleJob.status = 'error';
      googleJob.error = err.message || String(err);
      googleJob.finishedAt = new Date().toISOString();
      console.log(`[IMG] google job error: ${googleJob.error}`);
    }
  })();
});

/** Códigos únicos de producto (desde escaneos) + estado de imagen */
router.get('/', (req, res) => {
  const db = getDb();
  const q = String(req.query.q || '').trim();
  const params = {};
  let whereExtra = '';
  if (q) {
    whereExtra = `AND (
      IFNULL(d.articulo, '') LIKE @q
      OR IFNULL(d.codigo_barra, '') LIKE @q
      OR IFNULL(d.itemdesc, '') LIKE @q
      OR IFNULL(d.codigo_escaneado, '') LIKE @q
    )`;
    params.q = `%${q}%`;
  }

  const rows = db
    .prepare(
      `SELECT
         TRIM(COALESCE(NULLIF(d.articulo, ''), NULLIF(d.codigo_barra, ''), d.codigo_escaneado)) AS codigo,
         MAX(IFNULL(d.itemdesc, '')) AS descripcion,
         MAX(IFNULL(d.codigo_barra, d.codigo_escaneado)) AS codigo_barra,
         COUNT(*) AS cantidad,
         MIN(COALESCE(d.orden, d.id)) AS primer_orden
       FROM devoluciones d
       WHERE TRIM(COALESCE(NULLIF(d.articulo, ''), NULLIF(d.codigo_barra, ''), d.codigo_escaneado)) != ''
       ${whereExtra}
       GROUP BY TRIM(COALESCE(NULLIF(d.articulo, ''), NULLIF(d.codigo_barra, ''), d.codigo_escaneado))
       ORDER BY primer_orden ASC`
    )
    .all(params);

  const imgByCodigo = new Map(
    db
      .prepare(
        `SELECT codigo, filename, mime, original_name, actualizado_en
         FROM producto_imagenes`
      )
      .all()
      .map((r) => [String(r.codigo), r])
  );

  const items = rows.map((r, idx) => {
    const codigo = String(r.codigo);
    const img = imgByCodigo.get(codigo) || null;
    const tienePreview = Boolean(img) && fs.existsSync(previewPathFor(codigo));
    return {
      n: idx + 1,
      codigo,
      descripcion: r.descripcion || '—',
      codigoBarra: r.codigo_barra || '—',
      cantidad: Number(r.cantidad || 0),
      tieneImagen: Boolean(img),
      tienePreview,
      imagenUrl: img
        ? `/api/producto-imagenes/${encodeURIComponent(codigo)}/file?t=${encodeURIComponent(img.actualizado_en || '')}`
        : null,
      previewUrl: tienePreview
        ? `/api/producto-imagenes/${encodeURIComponent(codigo)}/preview?t=${Date.now()}`
        : null,
      actualizadoEn: img?.actualizado_en || null,
    };
  });

  res.json({
    items,
    totales: {
      codigos: items.length,
      conImagen: items.filter((x) => x.tieneImagen).length,
      sinImagen: items.filter((x) => !x.tieneImagen).length,
    },
  });
});

function previewFilename(codigo) {
  return `${normalizeCodigo(codigo)}.preview.jpg`;
}

function previewPathFor(codigo) {
  return path.join(imagenesDir, previewFilename(codigo));
}

function unlinkQuiet(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

router.get('/:codigo/file', (req, res) => {
  const db = getDb();
  const codigo = String(req.params.codigo || '').trim();
  const row = db
    .prepare(`SELECT filename, mime FROM producto_imagenes WHERE codigo = ?`)
    .get(codigo);
  if (!row) {
    return res.status(404).json({ error: 'Sin imagen para este código' });
  }
  const filePath = path.join(imagenesDir, row.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo de imagen no encontrado' });
  }
  res.setHeader('Content-Type', row.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.sendFile(filePath);
});

/** Sirve la preview IA pendiente de aceptar (no reemplaza la original). */
router.get('/:codigo/preview', (req, res) => {
  const codigo = String(req.params.codigo || '').trim();
  const filePath = previewPathFor(codigo);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'No hay preview IA pendiente' });
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(filePath);
});

/** Genera preview IA sin tocar la imagen original. */
router.post('/:codigo/enhance', async (req, res) => {
  const db = getDb();
  const codigo = String(req.params.codigo || '').trim();
  const started = Date.now();
  routeLog('H4', 'productoImagenes.js:enhance:request', 'enhance request', {
    codigo,
    inFlight: enhanceInFlight.size,
  });

  if (!codigo) {
    return res.status(400).json({ error: 'Código inválido' });
  }
  if (!isBflConfigured()) {
    return res.status(400).json({
      error:
        'Falta BFL_API_KEY. Agrégala en backend/.env para mejorar imágenes con Black Forest Labs.',
    });
  }
  if (enhanceInFlight.has(codigo)) {
    routeLog('H4', 'productoImagenes.js:enhance:busy', 'enhance already in flight', { codigo });
    return res.status(409).json({
      error: 'Ya hay una mejora IA en curso para este código. Espera a que termine.',
    });
  }

  const row = db
    .prepare(
      `SELECT codigo, filename, mime, original_name, actualizado_en
       FROM producto_imagenes WHERE codigo = ?`
    )
    .get(codigo);
  if (!row) {
    return res.status(404).json({
      error: 'Primero sube una imagen original con el botón Subir',
    });
  }

  const filePath = path.join(imagenesDir, row.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo de imagen no encontrado' });
  }

  const previewPath = previewPathFor(codigo);
  let enhanceInfo;
  enhanceInFlight.add(codigo);
  try {
    enhanceInfo = await enhanceProductImage(filePath, row.mime || 'image/jpeg', {
      outPath: previewPath,
    });
  } catch (enhanceErr) {
    unlinkQuiet(previewPath);
    routeLog('H5', 'productoImagenes.js:enhance:error', 'enhance failed', {
      codigo,
      elapsedMs: Date.now() - started,
      error: enhanceErr.message || String(enhanceErr),
    });
    return res.status(502).json({
      error: enhanceErr.message || 'No se pudo mejorar la imagen con IA',
    });
  } finally {
    enhanceInFlight.delete(codigo);
  }

  const t = Date.now();
  routeLog('H4', 'productoImagenes.js:enhance:ok', 'enhance preview ready', {
    codigo,
    method: enhanceInfo?.method || null,
    bytes: enhanceInfo?.bytes || null,
    timings: enhanceInfo?.timings || null,
    elapsedMs: Date.now() - started,
  });
  res.json({
    ok: true,
    codigo,
    pending: true,
    enhanced: true,
    enhanceMethod: enhanceInfo?.method || null,
    mime: enhanceInfo?.mime || 'image/jpeg',
    timings: enhanceInfo?.timings || null,
    originalUrl: `/api/producto-imagenes/${encodeURIComponent(codigo)}/file?t=${encodeURIComponent(row.actualizado_en || '')}`,
    previewUrl: `/api/producto-imagenes/${encodeURIComponent(codigo)}/preview?t=${t}`,
  });
});

/** Acepta la preview IA y reemplaza la imagen original. */
router.post('/:codigo/enhance/accept', (req, res) => {
  const db = getDb();
  const codigo = String(req.params.codigo || '').trim();
  routeLog('H4', 'productoImagenes.js:accept', 'accept preview', { codigo });
  const row = db
    .prepare(
      `SELECT codigo, filename, mime, original_name, actualizado_en
       FROM producto_imagenes WHERE codigo = ?`
    )
    .get(codigo);
  if (!row) {
    return res.status(404).json({ error: 'Sin imagen original para este código' });
  }

  const previewPath = previewPathFor(codigo);
  if (!fs.existsSync(previewPath)) {
    return res.status(404).json({ error: 'No hay preview IA para aceptar' });
  }

  const finalName = `${normalizeCodigo(codigo)}.jpg`;
  const finalPath = path.join(imagenesDir, finalName);
  const oldPath = path.join(imagenesDir, row.filename);

  try {
    fs.copyFileSync(previewPath, finalPath);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudo guardar la imagen IA' });
  }
  unlinkQuiet(previewPath);
  if (oldPath !== finalPath) unlinkQuiet(oldPath);

  db.prepare(
    `UPDATE producto_imagenes
     SET filename = ?, mime = ?, actualizado_en = datetime('now', 'localtime')
     WHERE codigo = ?`
  ).run(finalName, 'image/jpeg', codigo);

  const updated = db
    .prepare(
      `SELECT codigo, filename, mime, original_name, actualizado_en
       FROM producto_imagenes WHERE codigo = ?`
    )
    .get(codigo);

  routeLog('H4', 'productoImagenes.js:accept:ok', 'accept done', {
    codigo,
    filename: updated.filename,
  });
  res.json({
    ok: true,
    codigo: updated.codigo,
    mime: updated.mime,
    actualizadoEn: updated.actualizado_en,
    accepted: true,
    imagenUrl: `/api/producto-imagenes/${encodeURIComponent(codigo)}/file?t=${encodeURIComponent(updated.actualizado_en || '')}`,
  });
});

/** Descarta la preview IA y deja la original. */
router.post('/:codigo/enhance/discard', (req, res) => {
  const codigo = String(req.params.codigo || '').trim();
  unlinkQuiet(previewPathFor(codigo));
  routeLog('H4', 'productoImagenes.js:discard', 'discard preview', { codigo });
  res.json({ ok: true, codigo, discarded: true });
});

/** Sube imagen ORIGINAL (sin IA). */
router.post('/:codigo', (req, res) => {
  upload.single('imagen')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'No se pudo subir la imagen' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Falta el archivo imagen' });
    }

    const db = getDb();
    const codigo = String(req.params.codigo || '').trim();
    if (!codigo) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
      return res.status(400).json({ error: 'Código inválido' });
    }

    const mime = req.file.mimetype;

    const prev = db
      .prepare(`SELECT filename FROM producto_imagenes WHERE codigo = ?`)
      .get(codigo);
    if (prev?.filename && prev.filename !== req.file.filename) {
      unlinkQuiet(path.join(imagenesDir, prev.filename));
    }
    unlinkQuiet(previewPathFor(codigo));

    db.prepare(
      `INSERT INTO producto_imagenes (codigo, filename, mime, original_name, actualizado_en)
       VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(codigo) DO UPDATE SET
         filename = excluded.filename,
         mime = excluded.mime,
         original_name = excluded.original_name,
         actualizado_en = excluded.actualizado_en`
    ).run(codigo, req.file.filename, mime, req.file.originalname || null);

    const row = db
      .prepare(
        `SELECT codigo, filename, mime, original_name, actualizado_en
         FROM producto_imagenes WHERE codigo = ?`
      )
      .get(codigo);

    res.json({
      ok: true,
      codigo: row.codigo,
      mime: row.mime,
      actualizadoEn: row.actualizado_en,
      enhanced: false,
      enhanceMethod: null,
      imagenUrl: `/api/producto-imagenes/${encodeURIComponent(codigo)}/file?t=${encodeURIComponent(row.actualizado_en || '')}`,
    });
  });
});

router.delete('/:codigo', (req, res) => {
  const db = getDb();
  const codigo = String(req.params.codigo || '').trim();
  const row = db
    .prepare(`SELECT filename FROM producto_imagenes WHERE codigo = ?`)
    .get(codigo);
  if (!row) {
    return res.status(404).json({ error: 'Sin imagen para este código' });
  }
  const filePath = path.join(imagenesDir, row.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
  db.prepare(`DELETE FROM producto_imagenes WHERE codigo = ?`).run(codigo);
  res.json({ ok: true, codigo });
});

export default router;
