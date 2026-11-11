import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const WEBP_MIME = 'image/webp';
export const WEBP_EXT = '.webp';

/** Formatos de entrada aceptados (se normalizan a WebP). */
export const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif',
]);

/**
 * Convierte un archivo de imagen a WebP en destPath.
 * @returns {Promise<{ bytes: number, mime: string, path: string }>}
 */
export async function convertFileToWebp(srcPath, destPath, { quality = 82 } = {}) {
  const buf = await sharp(srcPath, { animated: false, failOn: 'none' })
    .rotate()
    .webp({ quality, effort: 4 })
    .toBuffer();
  fs.writeFileSync(destPath, buf);
  return { bytes: buf.length, mime: WEBP_MIME, path: destPath };
}

/**
 * Convierte un Buffer a WebP y lo escribe en destPath.
 */
export async function convertBufferToWebp(buf, destPath, { quality = 82 } = {}) {
  const out = await sharp(buf, { animated: false, failOn: 'none' })
    .rotate()
    .webp({ quality, effort: 4 })
    .toBuffer();
  fs.writeFileSync(destPath, out);
  return { bytes: out.length, mime: WEBP_MIME, path: destPath };
}

export function webpFilenameForCodigo(codigo) {
  const safe = String(codigo || '')
    .trim()
    .replace(/[^\w.-]+/g, '_');
  return `${safe}${WEBP_EXT}`;
}

export function thumbFilenameForCodigo(codigo) {
  const safe = String(codigo || '')
    .trim()
    .replace(/[^\w.-]+/g, '_');
  return `${safe}.thumb.webp`;
}

/**
 * Genera (o reutiliza) un thumb WebP pequeño para carga rápida en UI.
 * @returns {Promise<{ path: string, mime: string, bytes: number, cached: boolean }>}
 */
export async function ensureProductoImagenThumb({
  codigo,
  srcPath,
  destDir,
  size = 160,
  quality = 70,
}) {
  const thumbName = thumbFilenameForCodigo(codigo);
  const thumbPath = path.join(destDir, thumbName);
  if (fs.existsSync(thumbPath)) {
    const srcStat = fs.statSync(srcPath);
    const thumbStat = fs.statSync(thumbPath);
    if (thumbStat.mtimeMs >= srcStat.mtimeMs && thumbStat.size > 0) {
      return {
        path: thumbPath,
        mime: WEBP_MIME,
        bytes: thumbStat.size,
        cached: true,
      };
    }
  }
  const buf = await sharp(srcPath, { animated: false, failOn: 'none' })
    .rotate()
    .resize(size, size, { fit: 'cover', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer();
  fs.writeFileSync(thumbPath, buf);
  return { path: thumbPath, mime: WEBP_MIME, bytes: buf.length, cached: false };
}

export function isAlreadyWebp(filename, mime) {
  const name = String(filename || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  return name.endsWith('.webp') || m === WEBP_MIME;
}

/**
 * Si el archivo no es WebP, convierte a `${codigo}.webp` y borra el original.
 * Si ya es WebP con el nombre correcto, no hace nada.
 */
export async function ensureProductoImagenWebp({
  codigo,
  srcPath,
  destDir,
  unlinkSrc = true,
}) {
  const destName = webpFilenameForCodigo(codigo);
  const destPath = path.join(destDir, destName);
  const samePath = path.resolve(srcPath) === path.resolve(destPath);
  const already =
    samePath &&
    String(srcPath).toLowerCase().endsWith('.webp') &&
    fs.existsSync(srcPath);

  if (already) {
    const st = fs.statSync(srcPath);
    return {
      filename: destName,
      mime: WEBP_MIME,
      path: destPath,
      bytes: st.size,
      converted: false,
    };
  }

  const result = await convertFileToWebp(srcPath, destPath);
  if (unlinkSrc && path.resolve(srcPath) !== path.resolve(destPath)) {
    try {
      fs.unlinkSync(srcPath);
    } catch {
      /* ignore */
    }
  }
  return {
    filename: destName,
    mime: WEBP_MIME,
    path: destPath,
    bytes: result.bytes,
    converted: true,
  };
}
