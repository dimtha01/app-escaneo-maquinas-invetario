/**
 * Black Forest Labs — mejora de imagen antes de guardar.
 * 1) FLUX.2 con prompt de catálogo e-commerce (fondo blanco #FFF, 1:1)
 * 2) Si falla, FLUX Deblur (solo nitidez; no aplica fondo blanco)
 */
import fs from 'node:fs';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const BFL_BASE = 'https://api.bfl.ai';

/** Proxy opcional (ej. gluetun HTTP proxy) — la IP del servidor SVRATC está bloqueada por BFL/Azure. */
function getProxyUri() {
  return String(
    process.env.BFL_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
  ).trim();
}

let proxyAgent = null;
function getDispatcher() {
  const uri = getProxyUri();
  if (!uri) return undefined;
  if (!proxyAgent) {
    proxyAgent = new ProxyAgent(uri);
    console.log(`[BFL] using HTTP proxy ${uri.replace(/\/\/.*@/, '//***@')}`);
  }
  return proxyAgent;
}

/** fetch que respeta BFL_HTTP_PROXY (Node fetch nativo ignora HTTPS_PROXY). */
function bflFetch(url, options = {}) {
  const dispatcher = getDispatcher();
  if (!dispatcher) return fetch(url, options);
  return undiciFetch(url, { ...options, dispatcher });
}

const ENHANCE_PROMPT = [
  'You are an expert commercial product photographer and professional image retouching specialist.',
  '',
  'TASK: Transform the input photograph into a premium, photorealistic e-commerce catalog image while preserving the original product with maximum accuracy.',
  '',
  'PRIORITY ORDER:',
  '1) Exact product identity, geometry and physical accuracy.',
  '2) Preservation of original condition, components and details.',
  '3) Single-product presentation without additional objects.',
  '4) Consistent background, perspective and composition.',
  '5) Professional lighting, sharpness and image quality.',
  '',
  'PRODUCT PRESERVATION — HIGHEST PRIORITY:',
  'Use the supplied photograph as the absolute source of truth.',
  'Preserve the exact product, manufacturer, model, design, shape, proportions, colors, materials, textures and original finish.',
  'Maintain every visible screw, bolt, button, dial, handle, switch, connector, cable, vent, hinge, foot, label, sticker, engraving and component.',
  'Preserve existing scratches, dust, wear, damage, defects, missing parts and original physical condition.',
  'Never redesign, replace, repair, clean, restore, repaint, polish, simplify or modernize the product.',
  'Never add, remove, duplicate, reposition or modify any product component.',
  'Preserve all visible branding, logos, model numbers and printed text exactly as shown.',
  'If text is illegible, preserve its original appearance rather than inventing characters.',
  'Never invent hidden components or unsupported product geometry.',
  '',
  'SINGLE PRODUCT PRESENTATION:',
  'Show exactly ONE product in ONE configuration and ONE viewpoint.',
  'The product must be fully visible, complete, upright and naturally positioned.',
  'No duplicates, multiple views, collages, comparisons, grids or exploded diagrams.',
  'Remove packaging, cardboard boxes, plastic wrapping, bags and unrelated objects.',
  'Do not remove accessories or components physically attached to the product.',
  '',
  'PERSPECTIVE AND CAMERA:',
  'MANDATORY: rotate every product to the SAME standardized three-quarter catalog perspective, exactly 45 degrees horizontally.',
  'Always show the front and one side of the product. This 45-degree orientation is required for every product, without exception.',
  'Apply the rotation while keeping accurate proportions and straight vertical lines; do not deform, stretch or lose product components.',
  'Camera slightly elevated above the product mid-height, tilting down only about 10 degrees (a subtle high angle that shows just a hint of the top of the product).',
  'This elevation must be identical for every product: same height, same 10-degree downward tilt, same viewpoint.',
  'No strong tilt, no keystone distortion, no fisheye effects. Use an approximately 85mm full-frame equivalent perspective.',
  'The 45-degree three-quarter angle is non-negotiable: never keep the original input viewpoint and never fall back to a front-only or side-only view.',
  '',
  'BACKGROUND:',
  'Use a pure, uniform, solid white background (#FFFFFF) across the entire canvas.',
  'No gradients, textures, vignette, scenery, walls, floor lines or horizon.',
  'No background reflections, decorative elements or color casts.',
  'Allow only a minimal, soft, natural contact shadow immediately beneath the product.',
  'Ensure precise isolation and clean natural edges, including small or thin components.',
  '',
  'FRAMING AND COMPOSITION:',
  'Final image must use a square 1:1 aspect ratio.',
  'Target resolution: exactly 1024x1024 pixels.',
  'Position the product at the horizontal and vertical center of the canvas.',
  'SIZE CONSISTENCY: define one fixed centered bounding box equal to 80% of the canvas width and 80% of the canvas height (a square 80% x 80% area around the center).',
  'Scale every product uniformly so it fits EXACTLY inside that 80% bounding box: the product largest dimension must reach about 80% of the canvas, and the other dimension must stay within the box, never exceeding it.',
  'All products must appear the SAME visual size in the final image, regardless of their real-world dimensions: never show one product smaller or larger than the standard 80% box.',
  'Keep equal margins on all four sides and preserve natural proportions.',
  'Never crop, stretch, compress or deform the product.',
  'Maintain standardized size, scale and composition across the entire catalog.',
  '',
  'STUDIO LIGHTING:',
  'Create professional commercial product photography lighting.',
  'Use a neutral daylight white balance around 5500K.',
  'Apply large, soft, diffuse key lighting with balanced fill illumination.',
  'Use subtle edge separation and controlled natural reflections.',
  'Preserve the original material appearance, finish and color accuracy.',
  'Avoid harsh shadows, blown highlights, artificial gloss and excessive contrast.',
  '',
  'IMAGE QUALITY:',
  'Produce an ultra-realistic commercial product photograph.',
  'Maintain sharp focus across the entire visible product.',
  'Improve photographic clarity, exposure, white balance and resolution without altering physical details.',
  'Preserve authentic textures, realistic reflections and natural micro-contrast.',
  'Avoid blur, noise, compression artifacts, artificial smoothing, oversharpening and HDR halos.',
  'No cartoon, illustration, CGI, synthetic plastic appearance or stylization.',
  '',
  'CATALOG CONSISTENCY:',
  'Use the same background color, lighting style, framing rules and camera perspective for every catalog image.',
  'Use the SAME camera angle for every product: identical 45-degree horizontal turn, identical slight elevation and identical 10-degree downward tilt.',
  'Use the SAME view for every product: the product always faces the same way, showing the front and the same side.',
  'Use the SAME visual size for every product: every product must fit the same centered 80% x 80% bounding box.',
  'Maintain consistent product alignment, visual scale and composition across all images.',
  'Preserve the individual proportions and geometry of each product.',
  'Never modify the actual product merely to achieve visual consistency.',
  '',
  'STRICT NEGATIVE CONSTRAINTS:',
  'No different products, invented parts, altered geometry, changed branding or modified labels.',
  'No additional accessories, decorations, packaging, people, hands or props.',
  'No duplicate products, multiple perspectives, collages, panels or before-and-after comparisons.',
  'No different camera angle, different elevation or different tilt between products.',
  'No different product size or scale between images: every product must look the same size inside the same 80% box.',
  'No captions, advertising text, watermarks, frames or borders.',
  'No restoration, artificial cleaning, repainting or removal of existing wear.',
  'No distorted shapes, melted details, duplicated components or unrealistic reflections.',
  'No artificial backgrounds, dramatic lighting, color filters or excessive retouching.',
  '',
  'FINAL VALIDATION:',
  'Verify that the product identity, model, proportions, colors, branding and visible components match the original photograph.',
  'Verify that exactly one complete product is visible.',
  'Verify that the background is pure white and the product is centered.',
  'Verify that all enhancements affect photographic presentation rather than product identity or condition.',
  'If any aesthetic requirement conflicts with product fidelity, product fidelity always wins.',
  '',
  'OUTPUT: Return only ONE final professional e-commerce product image without additional content.'
].join(' ');


function getApiKey() {
  return String(process.env.BFL_API_KEY || '').trim();
}

export function isBflConfigured() {
  return Boolean(getApiKey());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function msSince(started) {
  return Date.now() - started;
}

/** Log de etapas BFL (sin secretos ni base64). */
function bflLog(_hypothesisId, _location, message, data = {}) {
  console.log(
    `[BFL] ${message}${data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : ''}`
  );
}

function withTimeout(ms, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`${label} timeout ${ms}ms`)), ms);
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
  };
}

async function pollResult(pollingUrl, { timeoutMs = 120000, method = 'flux-2' } = {}) {
  const key = getApiKey();
  const started = Date.now();
  let polls = 0;
  let lastStatus = null;
  bflLog('H1', 'bflEnhance.js:pollResult:start', 'poll start', {
    method,
    timeoutMs,
    pollingHost: (() => {
      try {
        return new URL(pollingUrl).host;
      } catch {
        return 'invalid-url';
      }
    })(),
  });

  while (Date.now() - started < timeoutMs) {
    await sleep(700);
    polls += 1;
    const t = withTimeout(20000, 'BFL poll');
    let res;
    let data = {};
    try {
      res = await bflFetch(pollingUrl, {
        headers: { accept: 'application/json', 'x-key': key },
        signal: t.signal,
      });
      data = await res.json().catch(() => ({}));
    } catch (err) {
      t.clear();
      bflLog('H1', 'bflEnhance.js:pollResult:fetchError', 'poll fetch error', {
        method,
        polls,
        elapsedMs: msSince(started),
        error: err.message || String(err),
      });
      throw new Error(`BFL poll falló: ${err.message || err}`);
    }
    t.clear();

    if (!res.ok) {
      bflLog('H1', 'bflEnhance.js:pollResult:httpError', 'poll HTTP error', {
        method,
        polls,
        status: res.status,
        elapsedMs: msSince(started),
      });
      throw new Error(data?.detail || data?.error || `BFL poll HTTP ${res.status}`);
    }

    lastStatus = data.status || null;
    const terminalFail = new Set([
      'Error',
      'Failed',
      'Request Moderated',
      'Content Moderated',
      'Task not found',
      'Request Moderated.',
    ]);
    if (
      polls === 1 ||
      polls % 5 === 0 ||
      lastStatus === 'Ready' ||
      terminalFail.has(lastStatus)
    ) {
      bflLog('H1', 'bflEnhance.js:pollResult:tick', 'poll status', {
        method,
        polls,
        status: lastStatus,
        elapsedMs: msSince(started),
      });
    }

    if (data.status === 'Ready') {
      const sample = data?.result?.sample;
      if (!sample) throw new Error('BFL listo pero sin URL de imagen');
      bflLog('H1', 'bflEnhance.js:pollResult:ready', 'poll ready', {
        method,
        polls,
        elapsedMs: msSince(started),
        hasSample: true,
      });
      return sample;
    }
    if (terminalFail.has(data.status)) {
      bflLog('H7', 'bflEnhance.js:pollResult:moderated', 'poll terminal fail', {
        method,
        polls,
        status: data.status,
        elapsedMs: msSince(started),
        detail: String(data?.result?.error || data?.error || data?.details || '').slice(0, 240),
      });
      const reason =
        data.status === 'Request Moderated' || data.status === 'Content Moderated'
          ? 'BFL moderó la solicitud (contenido bloqueado)'
          : data?.result?.error || data?.error || `BFL estado: ${data.status}`;
      throw new Error(reason);
    }
    // Pending / Running / Processing → seguir
  }

  bflLog('H1', 'bflEnhance.js:pollResult:timeout', 'poll timeout', {
    method,
    polls,
    lastStatus,
    elapsedMs: msSince(started),
    timeoutMs,
  });
  throw new Error(`BFL timeout esperando la imagen mejorada (${timeoutMs}ms, last=${lastStatus})`);
}

async function submitJob(path, body) {
  const key = getApiKey();
  if (!key) throw new Error('Falta BFL_API_KEY en el backend');

  const started = Date.now();
  bflLog('H2', 'bflEnhance.js:submitJob:start', 'submit start', {
    path,
    promptChars: String(body.prompt || '').length || undefined,
    hasInputImage: Boolean(body.input_image || body.image),
    width: body.width || null,
    height: body.height || null,
  });

  const t = withTimeout(45000, `BFL submit ${path}`);
  let res;
  let data = {};
  try {
    res = await bflFetch(`${BFL_BASE}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        'x-key': key,
      },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    t.clear();
    bflLog('H2', 'bflEnhance.js:submitJob:error', 'submit fetch error', {
      path,
      elapsedMs: msSince(started),
      error: err.message || String(err),
    });
    throw new Error(`BFL submit falló: ${err.message || err}`);
  }
  t.clear();

  if (!res.ok) {
    const detail =
      typeof data?.detail === 'string'
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail.map((d) => d?.msg || JSON.stringify(d)).join('; ')
          : data?.error || `BFL HTTP ${res.status}`;
    bflLog('H2', 'bflEnhance.js:submitJob:httpError', 'submit HTTP error', {
      path,
      status: res.status,
      elapsedMs: msSince(started),
      detail: String(detail).slice(0, 240),
    });
    throw new Error(detail);
  }
  if (!data.polling_url) {
    throw new Error('BFL no devolvió polling_url');
  }

  bflLog('H2', 'bflEnhance.js:submitJob:ok', 'submit ok', {
    path,
    elapsedMs: msSince(started),
    hasPollingUrl: true,
    id: data.id || null,
  });
  return data;
}

async function downloadToFile(url, destPath) {
  const started = Date.now();
  bflLog('H3', 'bflEnhance.js:download:start', 'download start', {
    host: (() => {
      try {
        return new URL(url).host;
      } catch {
        return 'invalid';
      }
    })(),
  });
  const t = withTimeout(60000, 'BFL download');
  let res;
  try {
    res = await bflFetch(url, { signal: t.signal });
    if (!res.ok) throw new Error(`No se pudo descargar imagen BFL (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    const ctype = res.headers.get('content-type') || '';
    bflLog('H3', 'bflEnhance.js:download:ok', 'download ok', {
      bytes: buf.length,
      mime: ctype.split(';')[0] || 'image/jpeg',
      elapsedMs: msSince(started),
    });
    return { bytes: buf.length, mime: ctype.split(';')[0] || 'image/jpeg' };
  } catch (err) {
    bflLog('H3', 'bflEnhance.js:download:error', 'download error', {
      elapsedMs: msSince(started),
      error: err.message || String(err),
    });
    throw err;
  } finally {
    t.clear();
  }
}

function fileToDataUri(filePath, mime) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const safeMime = mime || 'image/jpeg';
  return `data:${safeMime};base64,${b64}`;
}

/**
 * Mejora la imagen con BFL.
 * Por defecto escribe en outPath; si no se pasa, sobrescribe filePath.
 * @returns {{ method: string, mime: string, bytes: number, outPath: string, timings: object }}
 */
export async function enhanceProductImage(filePath, mime = 'image/jpeg', { outPath } = {}) {
  if (!isBflConfigured()) {
    throw new Error('Configura BFL_API_KEY para mejorar imágenes con Black Forest Labs');
  }

  const totalStarted = Date.now();
  const destPath = outPath || filePath;
  let inputBytes = 0;
  try {
    inputBytes = fs.statSync(filePath).size;
  } catch {
    /* ignore */
  }

  bflLog('H4', 'bflEnhance.js:enhance:start', 'enhance start', {
    inputBytes,
    mime,
    hasOutPath: Boolean(outPath),
  });

  const input = fileToDataUri(filePath, mime);
  let method = 'flux-2';
  let sampleUrl;
  const timings = { readMs: msSince(totalStarted), submitMs: 0, pollMs: 0, downloadMs: 0 };

  try {
    const submitStarted = Date.now();
    // Catálogo e-commerce: editar con prompt (fondo blanco, misma máquina).
    // width/height fijos -> TODAS las imágenes salen del mismo tamaño (1:1, 1024x1024).
    const job = await submitJob('/v1/flux-2-pro', {
      prompt: ENHANCE_PROMPT,
      input_image: input,
      width: 1024,
      height: 1024,
      output_format: 'jpeg',
      safety_tolerance: 2,
      // Evita que FLUX.2 reescriba/expanda el prompt: se usa tal cual.
      disable_pup: true,
      // Seed fijo -> menor variación entre corridas.
      seed: 42,
    });
    timings.submitMs = msSince(submitStarted);

    const pollStarted = Date.now();
    sampleUrl = await pollResult(job.polling_url, { timeoutMs: 180000, method: 'flux-2' });
    timings.pollMs = msSince(pollStarted);
  } catch (err) {
    // Fallback: deblur (solo nitidez; no aplica fondo blanco)
    method = 'deblur';
    bflLog('H5', 'bflEnhance.js:enhance:fallback', 'flux-2 failed, trying deblur', {
      error: err.message || String(err),
      elapsedMs: msSince(totalStarted),
    });
    try {
      const submitStarted = Date.now();
      const job = await submitJob('/v1/flux-tools/deblur-v1', {
        image: input,
        output_format: 'jpeg',
        safety_tolerance: 2,
      });
      timings.submitMs += msSince(submitStarted);
      const pollStarted = Date.now();
      sampleUrl = await pollResult(job.polling_url, { timeoutMs: 120000, method: 'deblur' });
      timings.pollMs += msSince(pollStarted);
    } catch (deblurErr) {
      bflLog('H5', 'bflEnhance.js:enhance:failed', 'enhance failed both methods', {
        fluxError: err.message || String(err),
        deblurError: deblurErr.message || String(deblurErr),
        elapsedMs: msSince(totalStarted),
        timings,
      });
      throw new Error(
        `${err.message || 'FLUX.2 falló'}; fallback deblur: ${deblurErr.message || deblurErr}`
      );
    }
  }

  const downloadStarted = Date.now();
  const tmp = `${destPath}.bfl-tmp`;
  const { bytes, mime: outMime } = await downloadToFile(sampleUrl, tmp);
  fs.renameSync(tmp, destPath);
  timings.downloadMs = msSince(downloadStarted);
  timings.totalMs = msSince(totalStarted);

  bflLog('H4', 'bflEnhance.js:enhance:done', 'enhance done', {
    method,
    bytes,
    mime: outMime.includes('png') ? 'image/png' : 'image/jpeg',
    timings,
  });

  return {
    method,
    mime: outMime.includes('png') ? 'image/png' : 'image/jpeg',
    bytes,
    outPath: destPath,
    timings,
  };
}
