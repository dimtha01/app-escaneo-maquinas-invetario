#!/usr/bin/env node
/**
 * Convierte todas las imágenes de producto existentes a WebP (producción).
 *
 * Uso (desde backend/ o /app en Coolify):
 *   node scripts/convert-imagenes-webp.js --dry-run
 *   node scripts/convert-imagenes-webp.js
 *   SQLITE_PATH=/app/data/inventario.db node scripts/convert-imagenes-webp.js --dry-run
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  WEBP_MIME,
  ensureProductoImagenWebp,
  isAlreadyWebp,
} from '../src/services/imageWebp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || args.has('-n');

function resolveDbPath() {
  const fromEnv = process.env.SQLITE_PATH || process.env.DB_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  const idx = process.argv.indexOf('--db');
  if (idx >= 0 && process.argv[idx + 1]) {
    return path.resolve(process.argv[idx + 1]);
  }
  return path.resolve(__dirname, '../data/inventario.db');
}

function resolveImagenesDir(dbPath) {
  const fromEnv = process.env.PRODUCTO_IMAGENES_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(path.dirname(dbPath), 'producto-imagenes');
}

async function main() {
  const dbPath = resolveDbPath();
  const imagenesDir = resolveImagenesDir(dbPath);

  if (!fs.existsSync(dbPath)) {
    console.error(`[convert-webp] No existe la DB: ${dbPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(imagenesDir)) {
    console.error(`[convert-webp] No existe el directorio de imágenes: ${imagenesDir}`);
    process.exit(1);
  }

  console.log(`[convert-webp] DB: ${dbPath}`);
  console.log(`[convert-webp] Imágenes: ${imagenesDir}`);
  console.log(`[convert-webp] Modo: ${dryRun ? 'DRY-RUN' : 'WRITE'}`);

  const db = new Database(dbPath);
  const rows = db
    .prepare(
      `SELECT codigo, filename, mime FROM producto_imagenes ORDER BY codigo`
    )
    .all();

  const summary = {
    total: rows.length,
    alreadyWebp: 0,
    converted: 0,
    missingFile: 0,
    errors: 0,
  };

  const updateStmt = db.prepare(
    `UPDATE producto_imagenes
     SET filename = ?, mime = ?, actualizado_en = datetime('now', 'localtime')
     WHERE codigo = ?`
  );

  for (const row of rows) {
    const codigo = String(row.codigo || '').trim();
    const filename = String(row.filename || '').trim();
    const srcPath = path.join(imagenesDir, filename);

    if (!filename || !fs.existsSync(srcPath)) {
      summary.missingFile += 1;
      console.warn(`  ! ${codigo}: archivo ausente (${filename || '—'})`);
      continue;
    }

    if (isAlreadyWebp(filename, row.mime) && filename.toLowerCase().endsWith('.webp')) {
      // Asegura mime correcto en DB aunque el archivo ya sea webp
      if (!dryRun && row.mime !== WEBP_MIME) {
        updateStmt.run(filename, WEBP_MIME, codigo);
      }
      summary.alreadyWebp += 1;
      console.log(`  · ${codigo}: ya WebP (${filename})`);
      continue;
    }

    try {
      if (dryRun) {
        const st = fs.statSync(srcPath);
        console.log(
          `  ✓ ${codigo}: ${filename} → ${codigo}.webp (~${st.size} bytes) [dry-run]`
        );
        summary.converted += 1;
        continue;
      }

      const result = await ensureProductoImagenWebp({
        codigo,
        srcPath,
        destDir: imagenesDir,
        unlinkSrc: true,
      });
      updateStmt.run(result.filename, result.mime, codigo);
      summary.converted += 1;
      console.log(
        `  ✓ ${codigo}: ${filename} → ${result.filename} (${result.bytes} bytes)`
      );
    } catch (err) {
      summary.errors += 1;
      console.error(`  ! ${codigo}: ${err.message || err}`);
    }
  }

  console.log('[convert-webp] Resumen:', summary);
  db.close();
}

main().catch((err) => {
  console.error('[convert-webp] Falló:', err);
  process.exit(1);
});
