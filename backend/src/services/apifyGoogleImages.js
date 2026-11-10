/**
 * Búsqueda masiva de imágenes en Google vía Apify (hooli/google-images-scraper).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ApifyClient } from 'apify-client';

const ACTOR_ID = 'hooli/google-images-scraper';

function getToken() {
  return String(process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || '').trim();
}

export function isApifyConfigured() {
  return Boolean(getToken());
}

export function buildProductQuery({ codigo, descripcion, codigoBarra }) {
  const desc = String(descripcion || '')
    .replace(/\s+/g, ' ')
    .trim();
  const code = String(codigo || '').trim();
  const barra = String(codigoBarra || '').trim();
  // Query estable y reconocible para mapear resultados → producto
  const parts = [desc, code].filter(Boolean);
  if (barra && barra !== code && !parts.includes(barra)) parts.push(barra);
  return parts.join(' ').trim() || code;
}

/**
 * Un solo run de Apify con todas las queries (batch).
 * @returns {Promise<Map<string, Array<{imageUrl:string,title?:string,origin?:string}>>>}
 */
export async function searchGoogleImagesBatch(queries, { maxResultsPerQuery = 5 } = {}) {
  const token = getToken();
  if (!token) throw new Error('Falta APIFY_TOKEN en backend/.env');

  const unique = [...new Set(queries.map((q) => String(q || '').trim()).filter(Boolean))];
  if (!unique.length) return new Map();

  console.log(
    `[APIFY] start actor=${ACTOR_ID} queries=${unique.length} maxPer=${maxResultsPerQuery}`
  );
  const client = new ApifyClient({ token });
  const started = Date.now();
  const run = await client.actor(ACTOR_ID).call(
    {
      queries: unique,
      maxResultsPerQuery: Math.min(Math.max(Number(maxResultsPerQuery) || 5, 1), 20),
    },
    { waitSecs: 300 }
  );

  if (!run?.defaultDatasetId) {
    throw new Error(`Apify run sin dataset (status=${run?.status || '?'})`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 5000 });
  console.log(
    `[APIFY] done status=${run.status} items=${items.length} elapsedMs=${Date.now() - started}`
  );

  const byQuery = new Map();
  for (const q of unique) byQuery.set(q, []);

  for (const item of items || []) {
    const q = String(item.query || item.searchQuery || item.searchTerm || '').trim();
    const imageUrl = String(item.imageUrl || item.image_url || item.url || '').trim();
    if (!q || !imageUrl || !/^https?:\/\//i.test(imageUrl)) continue;
    const list = byQuery.get(q) || [];
    if (list.length >= maxResultsPerQuery) continue;
    list.push({
      imageUrl,
      title: item.title || null,
      origin: item.origin || item.contentUrl || null,
      width: item.imageWidth || null,
      height: item.imageHeight || null,
    });
    byQuery.set(q, list);
  }

  return byQuery;
}

async function downloadWithTimeout(url, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout descarga imagen')), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; InventarioBot/1.0; +local) AppleWebKit/537.36',
        Accept: 'image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ctype = (res.headers.get('content-type') || '').split(';')[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) throw new Error('archivo demasiado pequeño');
    return { buf, mime: ctype.startsWith('image/') ? ctype : 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}

function extForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.jpg';
}

/**
 * Descarga una URL de imagen y la guarda en destDir con nombre base (sin ext).
 * @returns {{ filename: string, mime: string, bytes: number, path: string }}
 */
export async function downloadImageToDir(imageUrl, destDir, baseName) {
  const { buf, mime } = await downloadWithTimeout(imageUrl);
  const ext = extForMime(mime);
  const filename = `${baseName}${ext}`;
  const filePath = path.join(destDir, filename);
  fs.writeFileSync(filePath, buf);
  return { filename, mime, bytes: buf.length, path: filePath };
}
