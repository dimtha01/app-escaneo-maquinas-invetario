import './style.css';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { api } from './api.js';

/** Costo unitario CORP (CURRCOST, USD) → número sin símbolo */
function formatCosto(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formatos de código de barras retail → lectura más rápida */
const BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
];

const state = {
  view: 'triage',
  flashOn: false,
  muted: false,
  scanning: false,
  /** Escaneo por cámara: off por defecto (pistola Bluetooth no lo necesita) */
  cameraOn: localStorage.getItem('triageCameraOn') === '1',
  producto: null,
  /** Último código buscado (pistola/cámara); el input solo se usa en manual */
  ultimoCodigo: '',
  /** Token para ignorar respuestas viejas si se escanea otro código */
  buscarSeq: 0,
  sucursales: [],
  estatus: [],
  historialHoy: [],
  selectedEstatusId: null,
  selectedTiendaId: null,
  openMenu: null, // 'status' | null
  tiendaModalMode: null, // 'triage' | 'inventario' | 'edit' | null
  scanner: null,
  lastScanAt: 0,
  /** Buffer pistola Bluetooth (teclado HID) */
  wedge: {
    buffer: '',
    lastAt: 0,
    timer: null,
    bound: false,
  },
  inventario: {
    items: [],
    totales: { registros: 0, cantidad: 0 },
    q: '',
    sucursalId: '',
    estatusId: '',
    loading: false,
    /** 'consolidado' = por código; 'detalle' = registros de un código */
    vista: 'consolidado',
    detalleCodigo: null,
    /** Orden consolidado: 'n' | 'cant' */
    sortBy: 'n',
    /** 'asc' | 'desc' */
    sortDir: 'asc',
  },
  imagenes: {
    items: [],
    totales: { codigos: 0, conImagen: 0, sinImagen: 0 },
    q: '',
    loading: false,
    uploadingCodigo: null,
    /** 'original' | 'ai' | null */
    uploadingMode: null,
    bflConfigured: false,
    apifyConfigured: false,
    googleJob: null,
    /** Preview IA pendiente de aceptar/descartar */
    enhancePreview: null,
  },
  edit: {
    id: null,
    orden: null,
    sucursalId: null,
    estatusId: null,
    cantidad: 1,
    notas: '',
    itemdesc: '',
    codigo: '',
    articulo: '',
    udm: 'UND',
    productoPreview: null,
  },
};

const app = document.querySelector('#app');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatTime(isoLike) {
  if (!isoLike) return '--:--';
  const m = String(isoLike).match(/(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  const normalized = isoLike.includes('T') ? isoLike : `${isoLike.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(isoLike) {
  if (!isoLike) return '—';
  const normalized = isoLike.includes('T') ? isoLike : `${isoLike.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return isoLike;
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function playBeep() {
  if (state.muted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 120);
  } catch {
    /* ignore */
  }
}

function showToast(message) {
  const toast = document.getElementById('toastNotification');
  const text = document.getElementById('toastText');
  if (!toast || !text) return;
  text.textContent = message;
  toast.classList.remove('translate-y-8', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');
  setTimeout(() => {
    toast.classList.add('translate-y-8', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 2200);
}

function currentHashView() {
  const hash = (location.hash || '#triage').replace('#', '');
  if (hash === 'inventario') return 'inventario';
  if (hash === 'imagenes' || hash === 'carga-img') return 'imagenes';
  return 'triage';
}

function navHtml() {
  const triageActive = state.view === 'triage';
  const invActive = state.view === 'inventario';
  const imgActive = state.view === 'imagenes';
  const active = 'text-primary font-bold';
  const idle = 'text-on-surface-variant hover:text-on-surface';
  return `
  <nav class="fixed bottom-0 inset-x-0 z-50 pb-safe bg-surface/90 backdrop-blur-xl shadow-[0_-2px_12px_rgba(0,0,0,0.05)]">
    <div class="flex justify-around items-center h-16 px-gutter-compact">
      <a class="flex flex-col items-center justify-center min-w-[72px] h-12 gap-0.5 ${triageActive ? active : idle} transition-colors" href="#triage" data-nav="triage">
        <span class="material-symbols-outlined text-[22px]">qr_code_scanner</span>
        <span class="font-label-sm text-label-sm">Triage</span>
      </a>
      <a class="relative flex flex-col items-center justify-center min-w-[72px] h-12 gap-0.5 ${invActive ? active : idle} transition-colors" href="#inventario" data-nav="inventario">
        <div class="relative">
          <span class="material-symbols-outlined text-[22px]">query_stats</span>
          <span id="navInventarioCount" class="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-primary-container text-on-primary font-code-sm text-[10px] flex items-center justify-center font-bold">${state.inventario.totales.registros || 0}</span>
        </div>
        <span class="font-label-sm text-label-sm">Inventario</span>
      </a>
      <a class="relative flex flex-col items-center justify-center min-w-[72px] h-12 gap-0.5 ${imgActive ? active : idle} transition-colors" href="#imagenes" data-nav="imagenes">
        <div class="relative">
          <span class="material-symbols-outlined text-[22px]">add_photo_alternate</span>
          <span id="navImagenesCount" class="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-surface-container-high text-on-surface font-code-sm text-[10px] flex items-center justify-center font-semibold">${state.imagenes.totales.codigos || 0}</span>
        </div>
        <span class="font-label-sm text-label-sm">Carga img</span>
      </a>
      <a class="flex flex-col items-center justify-center min-w-[72px] h-12 gap-0.5 ${idle} transition-colors" href="#triage">
        <span class="material-symbols-outlined text-[22px]">settings_input_component</span>
        <span class="font-label-sm text-label-sm">Ajustes</span>
      </a>
    </div>
  </nav>`;
}

function toastHtml() {
  return `
  <div class="fixed bottom-20 inset-x-gutter z-50 pointer-events-none transform translate-y-8 opacity-0 transition-all duration-200" id="toastNotification">
    <div class="bg-inverse-surface text-inverse-on-surface px-3 py-2.5 rounded-lg shadow-xl flex items-center gap-2 pointer-events-auto">
      <span class="material-symbols-outlined text-primary-fixed text-[20px]">check</span>
      <span id="toastText" class="font-body-md text-body-md font-medium">Listo.</span>
    </div>
  </div>`;
}

function estatusModalHtml() {
  return `
  <div id="estatusModal" class="hidden fixed inset-0 z-[70] items-end sm:items-center justify-center bg-on-surface/40 backdrop-blur-[2px] p-gutter">
    <div class="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-xl p-space-lg flex flex-col gap-space-md" role="dialog" aria-modal="true" aria-labelledby="estatusModalTitle">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h2 id="estatusModalTitle" class="font-headline-sm text-headline-sm text-on-surface">Nuevo estatus</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Escribe el nombre del nuevo estatus de devolución.</p>
        </div>
        <button type="button" id="closeEstatusModalBtn" class="w-8 h-8 rounded-full text-on-surface-variant hover:bg-surface-container flex items-center justify-center shrink-0" aria-label="Cerrar">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <div class="flex flex-col gap-1">
        <label for="nuevoEstatusNombre" class="font-label-sm text-label-sm text-on-surface-variant font-semibold">Nombre del estatus</label>
        <input id="nuevoEstatusNombre" type="text" maxlength="60" placeholder="Ej. Devolución incompleta" class="w-full h-11 px-3 rounded-lg bg-surface-container-low border border-outline-variant font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary" autocomplete="off" />
        <p id="estatusModalError" class="hidden font-body-sm text-body-sm text-error"></p>
      </div>
      <div class="flex items-center gap-2 pt-1">
        <button type="button" id="cancelEstatusBtn" class="flex-1 h-11 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high">Cancelar</button>
        <button type="button" id="confirmEstatusBtn" class="flex-1 h-11 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container flex items-center justify-center gap-1">
          <span class="material-symbols-outlined text-[18px]">add_circle</span>
          Agregar
        </button>
      </div>
    </div>
  </div>`;
}

function tiendaModalHtml() {
  return `
  <div id="tiendaModal" class="hidden fixed inset-0 z-[80] items-end sm:items-center justify-center bg-on-surface/40 backdrop-blur-[2px] p-gutter">
    <div class="w-full max-w-lg max-h-[85vh] bg-surface-container-lowest rounded-xl shadow-xl flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="tiendaModalTitle">
      <div class="flex items-start justify-between gap-2 p-space-md pb-2 shrink-0">
        <div class="min-w-0">
          <h2 id="tiendaModalTitle" class="font-headline-sm text-headline-sm text-on-surface">Seleccionar tienda</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Toca una tienda de la grilla</p>
        </div>
        <button type="button" id="closeTiendaModalBtn" class="w-8 h-8 rounded-full text-on-surface-variant hover:bg-surface-container flex items-center justify-center shrink-0" aria-label="Cerrar">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <div id="tiendaModalGrid" class="px-space-md pb-space-md overflow-y-auto grid grid-cols-4 gap-2"></div>
    </div>
  </div>`;
}

function editDevolucionModalHtml() {
  return `
  <div id="editDevolucionModal" class="hidden fixed inset-0 z-[75] items-end sm:items-center justify-center bg-on-surface/40 backdrop-blur-[2px] p-gutter">
    <div class="w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest rounded-xl shadow-xl p-space-lg flex flex-col gap-space-md" role="dialog" aria-modal="true" aria-labelledby="editDevolucionTitle">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h2 id="editDevolucionTitle" class="font-headline-sm text-headline-sm text-on-surface">Editar escaneo</h2>
          <p id="editDevolucionSubtitle" class="font-body-sm text-body-sm text-on-surface-variant mt-0.5 truncate"></p>
        </div>
        <button type="button" id="closeEditDevolucionBtn" class="w-8 h-8 rounded-full text-on-surface-variant hover:bg-surface-container flex items-center justify-center shrink-0" aria-label="Cerrar">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div class="flex flex-col gap-1">
        <label for="editCodigo" class="font-label-sm text-label-sm text-on-surface-variant font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-primary text-[16px]">qr_code_2</span>
          Código de barra <span class="text-error">*</span>
        </label>
        <div class="flex items-center gap-2">
          <input id="editCodigo" type="text" inputmode="numeric" autocomplete="off" class="flex-1 min-w-0 h-11 px-3 rounded-lg bg-surface-container-low border border-outline-variant font-code-md text-code-md text-on-surface focus:outline-none focus:border-primary" placeholder="Código de barra" />
          <button type="button" id="editBuscarCodigoBtn" class="h-11 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md shrink-0 inline-flex items-center gap-1">
            <span class="material-symbols-outlined text-[18px]">search</span>
            Buscar
          </button>
        </div>
      </div>

      <div id="editProductoPreview" class="rounded-xl bg-surface-container-low border border-outline-variant p-3 flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-primary-container"></span>
          <span class="font-label-sm text-label-sm text-primary font-bold">Producto</span>
        </div>
        <div id="editProductoNombre" class="font-headline-sm text-headline-sm text-on-surface truncate">—</div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-code-sm text-code-sm text-on-surface-variant">Código de producto <span id="editProductoArticulo">—</span></span>
          <span id="editProductoCodigoBarra" class="font-code-sm text-code-sm bg-surface-container px-1.5 py-0.5 rounded-DEFAULT text-on-secondary-container">—</span>
        </div>
        <div class="font-body-sm text-body-sm text-on-surface-variant">
          Cantidad: <span id="editProductoCantidad">1</span> <span id="editProductoUdm">UND</span>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-label-sm text-label-sm text-on-surface-variant font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-primary text-[16px]">store</span>
          Tienda <span class="text-error">*</span>
        </label>
        <button type="button" id="editTiendaBtn" class="w-full h-11 px-3 rounded-lg bg-surface-container-low border border-outline-variant flex items-center gap-2 text-left">
          <span class="material-symbols-outlined text-[20px] text-on-surface-variant">store</span>
          <span id="editTiendaLabel" class="flex-1 font-label-md text-label-md text-on-surface font-semibold truncate">Seleccionar tienda</span>
          <span class="material-symbols-outlined text-[20px] text-on-surface-variant">grid_view</span>
        </button>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-label-sm text-label-sm text-on-surface-variant font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-primary text-[16px]">assignment_return</span>
          Estatus <span class="text-error">*</span>
        </label>
        ${pickerHtml({ key: 'editStatus', icon: 'report', placeholder: 'Seleccionar estatus' })}
      </div>

      <p id="editDevolucionError" class="hidden font-body-sm text-body-sm text-error"></p>

      <div class="flex items-center gap-2 pt-1">
        <button type="button" id="cancelEditDevolucionBtn" class="flex-1 h-11 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high">Cancelar</button>
        <button type="button" id="saveEditDevolucionBtn" class="flex-1 h-11 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container flex items-center justify-center gap-1">
          <span class="material-symbols-outlined text-[18px]">save</span>
          Guardar
        </button>
      </div>
    </div>
  </div>`;
}

/* ---------------- Triage helpers ---------------- */

function renderHistorial() {
  const list = document.getElementById('historialList');
  const countBadge = document.getElementById('historialCount');
  const navBadge = document.getElementById('navHistorialCount');
  if (!list) return;

  const total = state.historialHoy.length;
  if (countBadge) countBadge.textContent = String(total);
  if (navBadge) navBadge.textContent = String(total);

  if (total === 0) {
    list.innerHTML = `
      <div class="p-3 text-center text-on-surface-variant font-body-sm text-body-sm border-y border-outline-variant bg-surface-container-lowest">
        Sin registros
      </div>`;
    return;
  }

  const rows = state.historialHoy
    .map((item) => {
      const codigo = item.Articulo || '—';
      const sku = item.CodigoBarra || item.codigo_escaneado || '—';
      const desc = item.ITEMDESC || '—';
      const tienda = item.sucursal_codigo || item.sucursal_nombre || '—';
      const estatus = item.estatus_nombre || '—';
      const n = item.orden ?? '—';
      return `
      <tr class="border-b border-surface-container-low hover:bg-surface-container-low/80" data-devolucion-id="${escapeHtml(item.id)}">
        <td class="inv-sticky-n px-1 py-1.5 align-middle text-center border-r border-surface-container-high">
          <span class="font-code-md text-code-md font-black text-on-surface tabular-nums">${escapeHtml(n)}</span>
        </td>
        <td class="inv-sticky-codigo px-1.5 py-1.5 align-middle border-r border-surface-container-high">
          <div class="font-code-sm text-code-sm font-bold text-on-surface leading-tight">${escapeHtml(codigo)}</div>
        </td>
        <td class="px-1.5 py-1.5 align-middle min-w-[200px] max-w-[300px]">
          <div class="font-label-md text-label-md text-on-surface font-medium truncate whitespace-nowrap">${escapeHtml(desc)}</div>
        </td>
        <td class="px-1.5 py-1.5 align-middle whitespace-nowrap">
          <span class="font-code-sm text-code-sm font-bold text-on-surface">${escapeHtml(sku)}</span>
        </td>
        <td class="px-1.5 py-1.5 align-middle whitespace-nowrap">
          <span class="inline-flex items-center rounded-md bg-primary-fixed text-on-primary-fixed px-1.5 py-0.5 font-code-sm text-code-sm font-bold">${escapeHtml(tienda)}</span>
        </td>
        <td class="px-1.5 py-1.5 align-middle min-w-[110px]">
          <span class="font-label-sm text-label-sm text-on-surface font-semibold">${escapeHtml(estatus)}</span>
        </td>
        <td class="px-2 py-1.5 align-middle whitespace-nowrap text-right">
          <div class="inline-flex items-center gap-0.5">
            <button type="button" class="editDevolucionBtn h-8 w-8 rounded-lg text-primary hover:bg-primary-fixed/40 inline-flex items-center justify-center" data-id="${escapeHtml(item.id)}" aria-label="Editar #${escapeHtml(item.orden ?? item.id)}">
              <span class="material-symbols-outlined text-[18px]">edit</span>
            </button>
            <button type="button" class="deleteDevolucionBtn h-8 w-8 rounded-lg text-error hover:bg-error-container/30 inline-flex items-center justify-center" data-id="${escapeHtml(item.id)}" data-orden="${escapeHtml(item.orden ?? item.id)}" aria-label="Eliminar #${escapeHtml(item.orden ?? item.id)}">
              <span class="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  list.innerHTML = `
    <div id="historialTableWrap" class="m-0 p-0 border-y border-outline-variant bg-surface-container-lowest overflow-hidden">
      <div class="overflow-x-auto overscroll-x-contain touch-pan-x m-0 p-0" id="historialTableScroll">
        <table class="w-full min-w-[700px] border-collapse text-left m-0" id="historialDataTable">
          <thead>
            <tr class="bg-surface-container">
              <th class="inv-sticky-n px-1 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide border-r border-surface-container-high text-center">N°</th>
              <th class="inv-sticky-codigo px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide border-r border-surface-container-high leading-tight">Código de producto</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap">Descripción</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide leading-tight">Código de barra</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap">Tienda</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap">Estatus</th>
              <th class="px-2 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold w-16"></th>
            </tr>
          </thead>
          <tbody class="bg-surface-container-lowest">
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;

  list.querySelectorAll('.editDevolucionBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      openEditDevolucion(btn.dataset.id);
    });
  });
  list.querySelectorAll('.deleteDevolucionBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      eliminarDevolucion(btn.dataset.id, btn.dataset.orden);
    });
  });
}

async function eliminarDevolucion(id, orden) {
  const label = orden ? `#${orden}` : `id ${id}`;
  if (!window.confirm(`¿Eliminar el escaneo ${label}?`)) return;

  try {
    const result = await api.devoluciones.remove(id);
    showToast(result.mensaje || `Eliminado ${label}`);
    state.historialHoy = await api.devoluciones.hoy();
    renderHistorial();
    if (state.view === 'inventario') {
      await loadInventario();
    }
  } catch (err) {
    showToast(err.message || 'No se pudo eliminar.');
  }
}

function updateEditTiendaLabel() {
  const label = document.getElementById('editTiendaLabel');
  if (!label) return;
  const sucursal = state.sucursales.find(
    (s) => Number(s.id) === Number(state.edit.sucursalId)
  );
  label.textContent = sucursal
    ? `${sucursal.codigo}${sucursal.nombre ? ` · ${sucursal.nombre}` : ''}`
    : 'Seleccionar tienda';
}

function renderEditProductoPreview() {
  const nombre = document.getElementById('editProductoNombre');
  const articulo = document.getElementById('editProductoArticulo');
  const codigoBarra = document.getElementById('editProductoCodigoBarra');
  const cantidad = document.getElementById('editProductoCantidad');
  const udm = document.getElementById('editProductoUdm');
  if (!nombre) return;
  const p = state.edit.productoPreview;
  nombre.textContent = p?.ITEMDESC || state.edit.itemdesc || '—';
  articulo.textContent = p?.Articulo || state.edit.articulo || '—';
  codigoBarra.textContent = p?.CodigoBarra || state.edit.codigo || '—';
  cantidad.textContent = String(p?.Cantidad ?? state.edit.cantidad ?? 1);
  udm.textContent = p?.UdM || state.edit.udm || 'UND';
}

function renderEditEstatusSelect() {
  renderPickerMenu({
    key: 'editStatus',
    options: state.estatus.map((e) => ({
      value: String(e.id),
      label: e.nombre,
      icon: e.icono || 'report',
    })),
    value: state.edit.estatusId ? String(state.edit.estatusId) : '',
    placeholder: 'Seleccionar estatus',
    defaultIcon: 'report',
    onSelect: (v) => {
      state.edit.estatusId = v == null || v === '' ? null : Number(v);
      renderEditEstatusSelect();
    },
  });
}

async function buscarCodigoEnEdit() {
  const codigo = String(document.getElementById('editCodigo')?.value || '').trim();
  const err = document.getElementById('editDevolucionError');
  if (!codigo) {
    if (err) {
      err.textContent = 'Escribe el código';
      err.classList.remove('hidden');
    }
    return;
  }
  try {
    const producto = await api.productos.buscar(codigo);
    state.edit.codigo = producto.CodigoBarra || codigo;
    state.edit.articulo = producto.Articulo || '';
    state.edit.itemdesc = producto.ITEMDESC || '';
    state.edit.cantidad = Number(producto.Cantidad ?? 1);
    state.edit.udm = producto.UdM || 'UND';
    state.edit.productoPreview = producto;
    const input = document.getElementById('editCodigo');
    if (input) input.value = state.edit.codigo;
    renderEditProductoPreview();
    if (err) {
      err.classList.add('hidden');
      err.textContent = '';
    }
  } catch (e) {
    state.edit.productoPreview = null;
    renderEditProductoPreview();
    if (err) {
      err.textContent = e.status === 404 ? `No encontrado: ${codigo}` : e.message || 'Error al buscar';
      err.classList.remove('hidden');
    }
  }
}

async function openEditDevolucion(id) {
  const item =
    state.inventario.items.find((x) => Number(x.id) === Number(id)) ||
    state.historialHoy.find((x) => Number(x.id) === Number(id));
  if (!item) {
    showToast('No se encontró el escaneo');
    return;
  }
  if (!state.sucursales.length || !state.estatus.length) {
    try {
      await loadCatalogos();
    } catch {
      /* ignore */
    }
  }

  state.edit = {
    id: item.id,
    orden: item.orden ?? item.id,
    sucursalId: item.sucursal_id,
    estatusId: item.estatus_id,
    cantidad: Number(item.Cantidad ?? 1),
    notas: item.notas || '',
    itemdesc: item.ITEMDESC || '',
    codigo: item.CodigoBarra || item.codigo_escaneado || '',
    articulo: item.Articulo || '',
    udm: item.UdM || 'UND',
    productoPreview: {
      Articulo: item.Articulo,
      CodigoBarra: item.CodigoBarra || item.codigo_escaneado,
      ITEMDESC: item.ITEMDESC,
      Cantidad: item.Cantidad ?? 1,
      UdM: item.UdM || 'UND',
    },
  };

  const modal = document.getElementById('editDevolucionModal');
  if (!modal) return;

  const subtitle = document.getElementById('editDevolucionSubtitle');
  if (subtitle) {
    subtitle.textContent = `#${state.edit.orden}`;
  }
  const codigoInput = document.getElementById('editCodigo');
  if (codigoInput) codigoInput.value = state.edit.codigo;
  const err = document.getElementById('editDevolucionError');
  if (err) {
    err.classList.add('hidden');
    err.textContent = '';
  }

  renderEditProductoPreview();
  renderEditEstatusSelect();
  updateEditTiendaLabel();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  codigoInput?.focus();
}

function closeEditDevolucion() {
  const modal = document.getElementById('editDevolucionModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  state.edit.id = null;
}

async function saveEditDevolucion() {
  if (!state.edit.id) return;
  const err = document.getElementById('editDevolucionError');
  const showErr = (msg) => {
    if (!err) return;
    err.textContent = msg;
    err.classList.remove('hidden');
  };

  const codigo = String(document.getElementById('editCodigo')?.value || '').trim();
  const sucursalId = Number(state.edit.sucursalId);
  const estatusId = Number(
    document.getElementById('editStatusSelect')?.value || state.edit.estatusId
  );
  const preview = state.edit.productoPreview;

  if (!codigo) {
    showErr('Escribe el código');
    return;
  }
  if (!Number.isFinite(sucursalId) || sucursalId <= 0) {
    showErr('Selecciona una tienda');
    return;
  }
  if (!Number.isFinite(estatusId) || estatusId <= 0) {
    showErr('Selecciona un estatus');
    return;
  }

  const saveBtn = document.getElementById('saveEditDevolucionBtn');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const result = await api.devoluciones.update(state.edit.id, {
      codigo,
      CodigoBarra: preview?.CodigoBarra || codigo,
      Articulo: preview?.Articulo ?? state.edit.articulo,
      ITEMDESC: preview?.ITEMDESC ?? state.edit.itemdesc,
      Cantidad: preview?.Cantidad ?? state.edit.cantidad,
      UdM: preview?.UdM ?? state.edit.udm,
      sucursal_id: sucursalId,
      estatus_id: estatusId,
    });
    closeEditDevolucion();
    showToast(result.mensaje || 'Guardado');
    if (state.view === 'inventario') {
      await loadInventario();
    } else {
      state.historialHoy = await api.devoluciones.hoy();
      renderHistorial();
    }
  } catch (e) {
    showErr(e.message || 'No se pudo guardar');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function bindEditDevolucionEvents() {
  document.getElementById('closeEditDevolucionBtn')?.addEventListener('click', closeEditDevolucion);
  document.getElementById('cancelEditDevolucionBtn')?.addEventListener('click', closeEditDevolucion);
  document.getElementById('saveEditDevolucionBtn')?.addEventListener('click', () => {
    saveEditDevolucion();
  });
  document.getElementById('editBuscarCodigoBtn')?.addEventListener('click', () => {
    buscarCodigoEnEdit();
  });
  document.getElementById('editCodigo')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarCodigoEnEdit();
    }
  });
  document.getElementById('editTiendaBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openTiendaModal('edit');
  });
  document.getElementById('editStatusTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu('editStatus');
  });
  document.getElementById('editDevolucionModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'editDevolucionModal') closeEditDevolucion();
  });
}

function renderProductoCard() {
  const card = document.getElementById('productoCard');
  const empty = document.getElementById('productoEmpty');
  if (!card || !empty) return;

  if (!state.producto) {
    card.classList.add('hidden');
    card.classList.remove('flex');
    empty.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  card.classList.remove('hidden');
  card.classList.add('flex');

  document.getElementById('productoNombre').textContent = state.producto.ITEMDESC;
  document.getElementById('productoArticulo').textContent = state.producto.Articulo || '—';
  document.getElementById('productoCodigoBarra').textContent =
    state.producto.CodigoBarra || '—';
  document.getElementById('productoCantidad').textContent = String(
    state.producto.Cantidad ?? 1
  );
  document.getElementById('productoUdm').textContent = state.producto.UdM || 'UND';
}

function pickerHtml({ key, icon = 'list', placeholder = 'Seleccionar', modal = false }) {
  return `
    <div class="relative w-full" data-picker="${key}">
      <input type="hidden" id="${key}Select" value="" />
      <button
        type="button"
        id="${key}Trigger"
        class="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-outline-variant flex items-center gap-2 text-left focus:outline-none focus:border-primary hover:bg-surface-container transition-colors"
        aria-haspopup="${modal ? 'dialog' : 'listbox'}"
        aria-expanded="false"
      >
        <span id="${key}TriggerIcon" class="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">${escapeHtml(icon)}</span>
        <span id="${key}TriggerLabel" class="flex-1 min-w-0 font-label-md text-label-md font-semibold text-on-surface truncate">${escapeHtml(placeholder)}</span>
        <span id="${key}TriggerChevron" class="material-symbols-outlined text-[20px] text-on-surface-variant shrink-0">${modal ? 'grid_view' : 'expand_more'}</span>
      </button>
      ${
        modal
          ? ''
          : `<div
        id="${key}Menu"
        class="hidden absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-56 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest shadow-lg py-1"
        role="listbox"
      ></div>`
      }
    </div>`;
}

function closeAllMenus() {
  ['status', 'editStatus', 'invEstatus'].forEach((key) => {
    document.getElementById(`${key}Menu`)?.classList.add('hidden');
    const chevron = document.getElementById(`${key}TriggerChevron`);
    if (chevron) chevron.textContent = 'expand_more';
    document.getElementById(`${key}Trigger`)?.setAttribute('aria-expanded', 'false');
  });
  state.openMenu = null;
}

function toggleMenu(key) {
  if (state.openMenu === key) {
    closeAllMenus();
    return;
  }
  closeAllMenus();
  state.openMenu = key;
  document.getElementById(`${key}Menu`)?.classList.remove('hidden');
  const chevron = document.getElementById(`${key}TriggerChevron`);
  if (chevron) chevron.textContent = 'expand_less';
  document.getElementById(`${key}Trigger`)?.setAttribute('aria-expanded', 'true');
}

function renderPickerMenu({
  key,
  options,
  value,
  placeholder,
  defaultIcon,
  onSelect,
}) {
  const triggerLabel = document.getElementById(`${key}TriggerLabel`);
  const triggerIcon = document.getElementById(`${key}TriggerIcon`);
  const menu = document.getElementById(`${key}Menu`);
  const hidden = document.getElementById(`${key}Select`);
  if (!triggerLabel || !menu || !hidden) return;

  hidden.value = value == null || value === '' ? '' : String(value);
  const selected = options.find((o) => String(o.value) === String(value));

  triggerIcon.textContent = selected?.icon || defaultIcon;
  triggerLabel.textContent = selected?.label || placeholder;

  menu.innerHTML = options
    .map((o) => {
      const isSelected = String(o.value) === String(value);
      return `
        <button
          type="button"
          class="picker-option w-full px-3 py-2.5 flex items-center gap-2.5 text-left transition-colors ${
            isSelected
              ? 'bg-primary-fixed text-on-primary-fixed'
              : 'hover:bg-surface-container-low text-on-surface'
          }"
          data-value="${escapeHtml(o.value)}"
          role="option"
          aria-selected="${isSelected}"
        >
          <span class="material-symbols-outlined text-[18px] shrink-0 ${
            isSelected ? 'text-primary' : 'text-on-surface-variant'
          }">${escapeHtml(o.icon || defaultIcon)}</span>
          <span class="flex-1 min-w-0 font-label-md text-label-md font-semibold truncate">${escapeHtml(o.label)}</span>
          <span class="material-symbols-outlined text-[18px] shrink-0 ${
            isSelected ? 'text-primary' : 'text-transparent'
          }">check</span>
        </button>`;
    })
    .join('');

  menu.querySelectorAll('.picker-option').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onSelect(btn.dataset.value);
      closeAllMenus();
    });
  });

  if (state.openMenu === key) menu.classList.remove('hidden');
  else menu.classList.add('hidden');
}

function getSelectedEstatus() {
  return state.estatus.find((e) => Number(e.id) === Number(state.selectedEstatusId)) || null;
}

function selectEstatus(id) {
  state.selectedEstatusId = id == null || id === '' ? null : Number(id);
  renderEstatusSelect();
}

function renderEstatusSelect() {
  // Sin estatus por defecto: el usuario debe elegirlo al registrar.
  if (
    state.selectedEstatusId &&
    !state.estatus.some((e) => Number(e.id) === Number(state.selectedEstatusId))
  ) {
    state.selectedEstatusId = null;
  }

  renderPickerMenu({
    key: 'status',
    options: state.estatus.map((e) => ({
      value: String(e.id),
      label: e.nombre,
      icon: e.icono || 'report',
    })),
    value: state.selectedEstatusId ? String(state.selectedEstatusId) : '',
    placeholder: 'Seleccionar estatus',
    defaultIcon: 'report',
    onSelect: (v) => selectEstatus(v),
  });
}

function selectTienda(id) {
  state.selectedTiendaId = id == null || id === '' ? null : Number(id);
  renderTiendaSelect();
  updateBahiaHint();
}

function updateTiendaTrigger(key, { value, placeholder, defaultIcon }) {
  const triggerLabel = document.getElementById(`${key}TriggerLabel`);
  const triggerIcon = document.getElementById(`${key}TriggerIcon`);
  const hidden = document.getElementById(`${key}Select`);
  if (!triggerLabel || !hidden) return;

  hidden.value = value == null || value === '' ? '' : String(value);
  const selected = state.sucursales.find((s) => String(s.id) === String(value));
  if (triggerIcon) triggerIcon.textContent = selected ? 'store' : defaultIcon;
  if (value === '' && key === 'invTienda') {
    triggerLabel.textContent = 'Todas las tiendas';
  } else {
    triggerLabel.textContent = selected
      ? `${selected.codigo} - ${selected.nombre}`
      : placeholder;
  }
}

function renderTiendaSelect() {
  // Sin tienda por defecto: el usuario debe elegirla.
  if (
    state.selectedTiendaId &&
    !state.sucursales.some((s) => Number(s.id) === Number(state.selectedTiendaId))
  ) {
    state.selectedTiendaId = null;
  }

  updateTiendaTrigger('tienda', {
    value: state.selectedTiendaId ? String(state.selectedTiendaId) : '',
    placeholder: 'Seleccionar tienda',
    defaultIcon: 'store',
  });
}

function renderInvTiendaSelect() {
  updateTiendaTrigger('invTienda', {
    value: state.inventario.sucursalId || '',
    placeholder: 'Todas las tiendas',
    defaultIcon: 'storefront',
  });
}

function renderInvEstatusSelect() {
  if (
    state.inventario.estatusId &&
    !state.estatus.some((e) => String(e.id) === String(state.inventario.estatusId))
  ) {
    state.inventario.estatusId = '';
  }

  renderPickerMenu({
    key: 'invEstatus',
    options: [
      { value: '', label: 'Todos los estatus', icon: 'filter_list' },
      ...state.estatus.map((e) => ({
        value: String(e.id),
        label: e.nombre,
        icon: e.icono || 'report',
      })),
    ],
    value: state.inventario.estatusId ? String(state.inventario.estatusId) : '',
    placeholder: 'Todos los estatus',
    defaultIcon: 'filter_list',
    onSelect: (v) => {
      state.inventario.estatusId = v ? String(v) : '';
      state.inventario.vista = 'consolidado';
      state.inventario.detalleCodigo = null;
      renderInvEstatusSelect();
      loadInventario();
    },
  });
}

async function openTiendaModal(mode) {
  closeAllMenus();
  state.tiendaModalMode = mode;
  if (!state.sucursales.length) {
    try {
      await loadCatalogos();
    } catch {
      /* ignore */
    }
  }
  const modal = document.getElementById('tiendaModal');
  if (!modal) return;
  renderTiendaModalGrid();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeTiendaModal() {
  const modal = document.getElementById('tiendaModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  state.tiendaModalMode = null;
}

function renderTiendaModalGrid() {
  const grid = document.getElementById('tiendaModalGrid');
  if (!grid) return;

  const mode = state.tiendaModalMode;
  const selectedValue =
    mode === 'inventario'
      ? String(state.inventario.sucursalId || '')
      : mode === 'edit'
        ? String(state.edit.sucursalId || '')
        : state.selectedTiendaId
          ? String(state.selectedTiendaId)
          : '';

  if (!state.sucursales.length) {
    grid.className = 'px-space-md pb-space-md';
    grid.innerHTML = `
      <div class="rounded-xl bg-surface-container-low p-4 text-center text-on-surface-variant font-body-sm text-body-sm">
        No se pudieron cargar las tiendas. Revisa que el backend esté corriendo y recarga.
      </div>`;
    return;
  }

  grid.className = 'px-space-md pb-space-md overflow-y-auto grid grid-cols-4 gap-2';

  const cells = [];
  if (mode === 'inventario') {
    const allSelected = selectedValue === '';
    cells.push(`
      <button type="button" class="tiendaGridBtn aspect-square rounded-xl border flex flex-col items-center justify-center gap-0.5 px-1 transition-colors active:scale-95 ${
        allSelected
          ? 'bg-primary text-on-primary border-primary'
          : 'bg-surface-container-low text-on-surface border-outline-variant hover:bg-surface-container'
      }" data-value="">
        <span class="material-symbols-outlined text-[20px]">storefront</span>
        <span class="font-label-sm text-label-sm font-bold leading-tight">Todas</span>
      </button>`);
  }

  for (const s of state.sucursales) {
    const isSelected = String(s.id) === selectedValue;
    const isSinTienda = s.codigo === 'T00';
    const aria = isSinTienda
      ? 'T00 - Sin tienda'
      : `${s.codigo}${s.nombre ? ` - ${s.nombre}` : ''}`;
    cells.push(`
      <button type="button" class="tiendaGridBtn aspect-square rounded-xl border flex flex-col items-center justify-center gap-0.5 px-1 transition-colors active:scale-95 ${
        isSelected
          ? 'bg-primary text-on-primary border-primary shadow-md'
          : 'bg-surface-container-low text-on-surface border-outline-variant hover:bg-surface-container'
      }" data-value="${escapeHtml(s.id)}" aria-label="${escapeHtml(aria)}">
        <span class="font-code-md text-code-md font-black leading-none">${escapeHtml(s.codigo)}</span>
        ${
          isSinTienda
            ? '<span class="font-label-sm text-[9px] leading-tight opacity-80 text-center">Sin tienda</span>'
            : ''
        }
      </button>`);
  }

  grid.innerHTML = cells.join('');
  grid.querySelectorAll('.tiendaGridBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value ?? '';
      if (state.tiendaModalMode === 'inventario') {
        state.inventario.sucursalId = value;
        state.inventario.vista = 'consolidado';
        state.inventario.detalleCodigo = null;
        renderInvTiendaSelect();
        loadInventario();
      } else if (state.tiendaModalMode === 'edit') {
        state.edit.sucursalId = value === '' ? null : Number(value);
        updateEditTiendaLabel();
      } else {
        selectTienda(value === '' ? null : value);
      }
      closeTiendaModal();
    });
  });
}

function bindTiendaModalEvents() {
  document.getElementById('closeTiendaModalBtn')?.addEventListener('click', closeTiendaModal);
  document.getElementById('tiendaModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tiendaModal') closeTiendaModal();
  });
}

function updateBahiaHint() {
  const bahiaHint = document.getElementById('bahiaHint');
  if (!bahiaHint) return;
  const sucursal = state.sucursales.find(
    (s) => Number(s.id) === Number(state.selectedTiendaId)
  );
  bahiaHint.textContent = sucursal?.codigo || '—';
}

function fillSelects() {
  renderTiendaSelect();
  renderEstatusSelect();
  updateBahiaHint();
}

async function loadCatalogos() {
  const [sucursales, estatus, historial] = await Promise.all([
    api.sucursales.list(),
    api.estatus.list(),
    api.devoluciones.hoy(),
  ]);
  state.sucursales = sucursales;
  state.estatus = estatus;
  state.historialHoy = historial;
  if (state.view === 'triage') {
    fillSelects();
    renderHistorial();
  }
}

async function buscarProducto(codigo, { fillInput = false } = {}) {
  const clean = String(codigo || '').trim();
  if (!clean) {
    showToast('Ingresa o escanea un código.');
    return;
  }
  const input = document.getElementById('barcodeInput');
  // Solo el ingreso manual llena el formulario; pistola/cámara lo dejan vacío
  if (input) {
    if (fillInput) input.value = clean;
    else input.value = '';
  }
  state.ultimoCodigo = clean;

  // Nuevo escaneo: limpia la selección anterior y busca el nuevo
  const seq = ++state.buscarSeq;
  state.producto = null;
  renderProductoCard();

  try {
    const producto = await api.productos.buscar(clean);
    if (seq !== state.buscarSeq) return; // llegó una búsqueda más nueva
    state.producto = producto;
    playBeep();
    renderProductoCard();
    showToast(`Producto encontrado: ${producto.ITEMDESC}`);
  } catch (err) {
    if (seq !== state.buscarSeq) return;
    state.producto = null;
    renderProductoCard();
    showToast(err.status === 404 ? `No encontrado: ${clean}` : err.message);
  }
}

async function guardarDevolucion() {
  const codigo =
    state.producto?.CodigoBarra ||
    state.ultimoCodigo ||
    document.getElementById('barcodeInput')?.value?.trim() ||
    '';
  const sucursalId =
    document.getElementById('tiendaSelect')?.value || state.selectedTiendaId;
  const estatusId =
    document.getElementById('statusSelect')?.value || state.selectedEstatusId;

  if (!codigo) {
    showToast('Escanea o ingresa un código primero.');
    return;
  }
  if (!sucursalId) {
    showToast('Selecciona una tienda.');
    return;
  }
  if (!estatusId) {
    showToast('Selecciona un estatus.');
    return;
  }

  const saveBtn = document.getElementById('saveActionBtn');
  if (saveBtn) saveBtn.disabled = true;

  try {
    const result = await api.devoluciones.create({
      codigo,
      producto_id: state.producto?.id ?? null,
      sucursal_id: Number(sucursalId),
      estatus_id: Number(estatusId),
      Articulo: state.producto?.Articulo,
      CodigoBarra: state.producto?.CodigoBarra,
      ITEMDESC: state.producto?.ITEMDESC,
      Cantidad: state.producto?.Cantidad,
      UdM: state.producto?.UdM,
      CurrCost: state.producto?.CurrCost ?? 0,
    });

    showToast(result.mensaje || 'Devolución registrada.');
    state.historialHoy = await api.devoluciones.hoy();
    renderHistorial();
    nuevoEscaneo();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar.');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function nuevoEscaneo() {
  state.producto = null;
  state.ultimoCodigo = '';
  state.selectedTiendaId = null;
  state.selectedEstatusId = null;
  const input = document.getElementById('barcodeInput');
  if (input) input.value = '';
  renderProductoCard();
  renderTiendaSelect();
  renderEstatusSelect();
  updateBahiaHint();
}

function openEstatusModal() {
  const modal = document.getElementById('estatusModal');
  const input = document.getElementById('nuevoEstatusNombre');
  const error = document.getElementById('estatusModalError');
  if (!modal || !input) return;
  if (error) {
    error.textContent = '';
    error.classList.add('hidden');
  }
  input.value = '';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => input.focus(), 50);
}

function closeEstatusModal() {
  const modal = document.getElementById('estatusModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function confirmarNuevoEstatus() {
  const input = document.getElementById('nuevoEstatusNombre');
  const error = document.getElementById('estatusModalError');
  const confirmBtn = document.getElementById('confirmEstatusBtn');
  const nombre = input?.value?.trim() || '';

  if (!nombre) {
    if (error) {
      error.textContent = 'Escribe un nombre para el nuevo estatus.';
      error.classList.remove('hidden');
    }
    input?.focus();
    return;
  }

  if (confirmBtn) confirmBtn.disabled = true;
  try {
    const creado = await api.estatus.create({ nombre, icono: 'label' });
    state.estatus = await api.estatus.list();
    state.selectedEstatusId = Number(creado.id);
    fillSelects();
    closeEstatusModal();
    showToast(`Estatus agregado: ${creado.nombre}`);
  } catch (err) {
    if (error) {
      error.textContent = err.message || 'No se pudo crear el estatus.';
      error.classList.remove('hidden');
    }
    showToast(err.message || 'No se pudo crear el estatus.');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

async function startScanner() {
  if (!state.cameraOn) return;
  const regionId = 'scannerRegion';
  const region = document.getElementById(regionId);
  if (!region || state.scanning) return;

  const syncBarcodeGuide = (width, height) => {
    const guide = document.getElementById('barcodeGuide');
    if (!guide || !width || !height) return;
    guide.style.width = `${width}px`;
    guide.style.height = `${height}px`;
    guide.classList.remove('hidden');
  };

  const alignGuideToShaded = () => {
    const shaded = region.querySelector('#qr-shaded-region');
    if (shaded) {
      const bt = parseFloat(shaded.style.borderTopWidth) || 0;
      const bl = parseFloat(shaded.style.borderLeftWidth) || 0;
      const br = parseFloat(shaded.style.borderRightWidth) || 0;
      const bb = parseFloat(shaded.style.borderBottomWidth) || 0;
      const clearW = Math.round(region.clientWidth - bl - br);
      const clearH = Math.round(region.clientHeight - bt - bb);
      if (clearW > 0 && clearH > 0) {
        syncBarcodeGuide(clearW, clearH);
        return true;
      }
    }
    return false;
  };

  try {
    state.scanner = new Html5Qrcode(regionId, {
      verbose: false,
      formatsToSupport: BARCODE_FORMATS,
      useBarCodeDetectorIfSupported: true,
    });
    let lastQr = { width: 0, height: 0 };
    await state.scanner.start(
      { facingMode: 'environment' },
      {
        fps: 20,
        aspectRatio: 1.777,
        disableFlip: true,
        videoConstraints: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const width = Math.max(
            50,
            Math.min(Math.floor(viewfinderWidth * 0.92), viewfinderWidth - 6)
          );
          const height = Math.max(
            50,
            Math.min(Math.floor(viewfinderHeight * 0.7), viewfinderHeight - 8)
          );
          lastQr = { width, height };
          syncBarcodeGuide(width, height);
          return { width, height };
        },
      },
      (decodedText) => {
        const now = Date.now();
        if (now - state.lastScanAt < 900) return;
        state.lastScanAt = now;
        const codigo = String(decodedText || '').trim();
        if (!codigo) return;
        playBeep();
        buscarProducto(codigo, { fillInput: false });
      },
      () => {}
    );
    state.scanning = true;
    alignGuideToShaded();
    requestAnimationFrame(() => {
      if (!alignGuideToShaded() && lastQr.width) syncBarcodeGuide(lastQr.width, lastQr.height);
    });
    const hint = document.getElementById('scannerHint');
    const hintBarEl = document.getElementById('scannerHintBar');
    if (hint) hint.textContent = '';
    if (hintBarEl) {
      hintBarEl.classList.add('hidden');
      hintBarEl.classList.remove('flex');
    }
  } catch {
    const hint = document.getElementById('scannerHint');
    const hintBarEl = document.getElementById('scannerHintBar');
    if (hint) hint.textContent = '';
    if (hintBarEl) {
      hintBarEl.classList.add('hidden');
      hintBarEl.classList.remove('flex');
    }
  }
}

async function stopScanner() {
  if (!state.scanner) return;
  try {
    if (state.scanning) await state.scanner.stop();
    await state.scanner.clear();
  } catch {
    /* ignore */
  }
  state.scanner = null;
  state.scanning = false;
}

/* ---------------- Inventario ---------------- */

function inventarioCodigoKey(item) {
  return String(item.Articulo || item.CodigoBarra || item.codigo_escaneado || '—').trim();
}

function productoImagenUrl(codigo, { thumb = false } = {}) {
  const c = String(codigo || '').trim();
  if (!c || c === '—') return null;
  const kind = thumb ? 'thumb' : 'file';
  return `/api/producto-imagenes/${encodeURIComponent(c)}/${kind}`;
}

function imagenLightboxHtml() {
  return `
    <div id="imagenLightbox" class="hidden fixed inset-0 z-[80] bg-black/80 items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Imagen completa">
      <button type="button" id="imagenLightboxClose" class="absolute top-3 right-3 h-10 w-10 rounded-full bg-white/15 text-white hover:bg-white/25 inline-flex items-center justify-center" aria-label="Cerrar">
        <span class="material-symbols-outlined text-[22px]">close</span>
      </button>
      <img id="imagenLightboxImg" src="" alt="" class="max-w-full max-h-[90dvh] object-contain rounded-lg shadow-2xl" />
    </div>`;
}

function openImagenLightbox(url, alt = '') {
  const modal = document.getElementById('imagenLightbox');
  const img = document.getElementById('imagenLightboxImg');
  if (!modal || !img || !url) return;
  img.src = url;
  img.alt = alt || 'Imagen del producto';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeImagenLightbox() {
  const modal = document.getElementById('imagenLightbox');
  const img = document.getElementById('imagenLightboxImg');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  if (img) img.removeAttribute('src');
}

function bindImagenLightboxEvents() {
  const modal = document.getElementById('imagenLightbox');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  document.getElementById('imagenLightboxClose')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeImagenLightbox();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeImagenLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeImagenLightbox();
    }
  });
}

function itemCurrCost(item) {
  const n = Number(item?.CurrCost ?? item?.currcost ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function consolidarInventarioPorCodigo(items) {
  const map = new Map();
  for (const item of items) {
    const codigo = inventarioCodigoKey(item);
    const desc = String(item.ITEMDESC || '—').trim();
    const sku = item.CodigoBarra || item.codigo_escaneado || '—';
    const orden = Number(item.orden) || Number(item.id) || 0;
    const costo = itemCurrCost(item);
    const prev = map.get(codigo);
    if (prev) {
      prev.cantidad += 1;
      prev.costoTotal += costo;
      prev.items.push(item);
      if (orden > 0 && (prev.primerOrden === 0 || orden < prev.primerOrden)) {
        prev.primerOrden = orden;
      }
      if (prev.descripcion === '—' && desc !== '—') prev.descripcion = desc;
      if (!(prev.costoUnidad > 0) && costo > 0) prev.costoUnidad = costo;
    } else {
      map.set(codigo, {
        codigo,
        descripcion: desc,
        sku,
        cantidad: 1,
        costoUnidad: costo,
        costoTotal: costo,
        primerOrden: orden,
        items: [item],
      });
    }
  }
  // Asigna N° fijo por primerOrden (1 = primero escaneado) y luego aplica sort UI
  const grupos = [...map.values()].sort((a, b) => a.primerOrden - b.primerOrden);
  grupos.forEach((g, i) => {
    g.n = i + 1;
  });
  return ordenarGruposConsolidado(grupos);
}

function ordenarGruposConsolidado(grupos) {
  const dir = state.inventario.sortDir === 'desc' ? -1 : 1;
  const by = state.inventario.sortBy === 'cant' ? 'cant' : 'n';
  return [...grupos].sort((a, b) => {
    if (by === 'cant') {
      const d = (Number(a.cantidad) || 0) - (Number(b.cantidad) || 0);
      if (d !== 0) return d * dir;
      return ((Number(a.n) || 0) - (Number(b.n) || 0)) * dir;
    }
    return ((Number(a.n) || 0) - (Number(b.n) || 0)) * dir;
  });
}

function setInventarioSort(sortBy) {
  if (state.inventario.sortBy === sortBy) {
    state.inventario.sortDir = state.inventario.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.inventario.sortBy = sortBy;
    state.inventario.sortDir = 'asc';
  }
  if (state.inventario.vista === 'consolidado') {
    renderInventarioList();
  }
}

function sortHeaderLabel(label, key) {
  const active = state.inventario.sortBy === key;
  const icon = !active
    ? 'unfold_more'
    : state.inventario.sortDir === 'asc'
      ? 'arrow_upward'
      : 'arrow_downward';
  const color = active ? 'text-primary' : 'text-on-surface-variant';
  return `
    <button type="button" class="invSortBtn inline-flex items-center justify-center gap-0.5 whitespace-nowrap ${color} hover:text-primary font-label-sm text-label-sm font-bold uppercase tracking-wide" data-sort="${key}" aria-label="Ordenar por ${escapeHtml(label)}">
      <span>${escapeHtml(label)}</span>
      <span class="material-symbols-outlined text-[14px] leading-none shrink-0" aria-hidden="true">${icon}</span>
    </button>`;
}

function abrirDetalleCodigo(codigo) {
  state.inventario.vista = 'detalle';
  state.inventario.detalleCodigo = codigo;
  renderInventarioList();
}

function volverConsolidadoInventario() {
  state.inventario.vista = 'consolidado';
  state.inventario.detalleCodigo = null;
  renderInventarioList();
}

async function loadInventario() {
  state.inventario.loading = true;
  renderInventarioList();
  try {
    const data = await api.devoluciones.inventario({
      q: state.inventario.q,
      sucursalId: state.inventario.sucursalId,
      estatusId: state.inventario.estatusId,
    });
    state.inventario.items = data.items || [];
    state.inventario.totales = data.totales || { registros: 0, cantidad: 0 };
    // Si el código del detalle ya no tiene filas, volver al consolidado
    if (state.inventario.vista === 'detalle' && state.inventario.detalleCodigo) {
      const still = state.inventario.items.some(
        (it) => inventarioCodigoKey(it) === state.inventario.detalleCodigo
      );
      if (!still) {
        state.inventario.vista = 'consolidado';
        state.inventario.detalleCodigo = null;
      }
    }
  } catch (err) {
    showToast(err.message || 'No se pudo cargar inventario');
    state.inventario.items = [];
    state.inventario.totales = { registros: 0, cantidad: 0 };
  } finally {
    state.inventario.loading = false;
    renderInventarioList();
    const navCount = document.getElementById('navInventarioCount');
    if (navCount) navCount.textContent = String(state.inventario.totales.registros || 0);
  }
}

function renderInventarioList() {
  const list = document.getElementById('inventarioList');
  renderInventarioTotalesRow();
  if (!list) return;

  if (state.inventario.loading) {
    list.innerHTML = `<div class="p-4 text-center text-on-surface-variant font-body-sm text-body-sm">Cargando...</div>`;
    return;
  }

  if (!state.inventario.items.length) {
    list.innerHTML = `<div class="p-4 text-center text-on-surface-variant font-body-sm text-body-sm">Sin resultados</div>`;
    return;
  }

  if (state.inventario.vista === 'detalle' && state.inventario.detalleCodigo) {
    renderInventarioDetalleCodigo(list);
    return;
  }

  renderInventarioConsolidado(list);
}

function renderInventarioConsolidado(list) {
  const grupos = consolidarInventarioPorCodigo(state.inventario.items);
  const sortHint =
    state.inventario.sortBy === 'cant'
      ? `Cant. ${state.inventario.sortDir === 'asc' ? 'menor→mayor' : 'mayor→menor'}`
      : `N° ${state.inventario.sortDir === 'asc' ? 'primero→último' : 'último→primero'}`;

  const costoGlobal = grupos.reduce((sum, g) => sum + (Number(g.costoTotal) || 0), 0);

  const rows = grupos
    .map((g) => {
      const n = g.n;
      const unitTxt = formatCosto(g.costoUnidad);
      const totalTxt = formatCosto(g.costoTotal);
      return `
      <tr class="border-b border-surface-container-low hover:bg-primary-fixed/20 cursor-pointer invCodigoRow" data-codigo="${escapeHtml(g.codigo)}" data-n="${n}" data-cant="${escapeHtml(g.cantidad)}" data-costo="${escapeHtml(g.costoTotal)}" role="button" tabindex="0">
        <td class="inv-sticky-n px-1 py-2 align-middle text-center border-r border-surface-container-high">
          <span class="font-code-md text-code-md font-black text-on-surface tabular-nums">${n}</span>
        </td>
        <td class="inv-sticky-codigo px-1.5 py-2 align-middle border-r border-surface-container-high">
          <div class="font-code-sm text-code-sm font-bold text-on-surface leading-tight">${escapeHtml(g.codigo)}</div>
        </td>
        <td class="px-2 py-2 align-middle min-w-[220px]">
          <div class="font-label-md text-label-md text-on-surface font-medium leading-snug whitespace-normal break-words">${escapeHtml(g.descripcion)}</div>
        </td>
        <td class="px-1 py-2 align-middle text-center whitespace-nowrap">
          <span class="font-code-md text-code-md font-black text-on-surface tabular-nums">${escapeHtml(g.cantidad)}</span>
        </td>
        <td class="px-1.5 py-2 align-middle text-right whitespace-nowrap">
          <span class="font-code-sm text-code-sm font-bold text-on-surface tabular-nums">${escapeHtml(unitTxt)}</span>
        </td>
        <td class="px-1.5 py-2 align-middle text-right whitespace-nowrap">
          <span class="font-code-sm text-code-sm font-bold text-primary tabular-nums">${escapeHtml(totalTxt)}</span>
        </td>
        <td class="px-1 py-2 align-middle text-center">
          <span class="material-symbols-outlined text-[18px] text-on-surface-variant">chevron_right</span>
        </td>
      </tr>`;
    })
    .join('');

  list.innerHTML = `
    <div class="shrink-0 px-gutter pb-2.5">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px] text-primary">inventory_2</span>
        <div class="min-w-0">
          <h2 class="font-headline-sm text-headline-sm text-on-surface font-bold leading-tight">Consolidado por código</h2>
          <p class="font-label-sm text-label-sm text-on-surface-variant">Orden: ${escapeHtml(sortHint)} · toca N° o Cant. para ordenar</p>
        </div>
      </div>
    </div>
    <div id="inventarioTableWrap" class="flex-1 min-h-0 m-0 p-0 border-y border-outline-variant bg-surface-container-lowest overflow-hidden flex flex-col">
      <div class="inv-table-scroll m-0 p-0" id="inventarioTableScroll">
        <table class="w-full min-w-[720px] border-collapse text-left m-0" id="inventarioDataTable">
          <thead>
            <tr class="bg-surface-container">
              <th class="inv-sticky-n px-0.5 py-1.5 border-r border-surface-container-high text-center">${sortHeaderLabel('N°', 'n')}</th>
              <th class="inv-sticky-codigo px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide border-r border-surface-container-high leading-tight">Código de producto</th>
              <th class="px-2 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap">Descripción</th>
              <th class="px-0.5 py-1.5 text-center">${sortHeaderLabel('Cant.', 'cant')}</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap text-right">Costo/u</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap text-right">Costo total</th>
              <th class="px-1 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody class="bg-surface-container-lowest">
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;

  state.inventario.totales = {
    ...state.inventario.totales,
    costo: costoGlobal,
  };
  renderInventarioTotalesRow();

  list.querySelectorAll('.invSortBtn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setInventarioSort(btn.dataset.sort);
    });
  });

  list.querySelectorAll('.invCodigoRow').forEach((row) => {
    const open = () => abrirDetalleCodigo(row.dataset.codigo);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

function renderInventarioDetalleCodigo(list) {
  const codigo = state.inventario.detalleCodigo;
  const items = state.inventario.items.filter((it) => inventarioCodigoKey(it) === codigo);
  const desc = items[0]?.ITEMDESC || '—';

  const rows = items
    .map((item) => {
      const sku = item.CodigoBarra || item.codigo_escaneado || '—';
      const tienda = item.sucursal_codigo || item.sucursal_nombre || '—';
      const estatus = item.estatus_nombre || '—';
      const unitTxt = formatCosto(itemCurrCost(item));
      return `
      <tr class="border-b border-surface-container-low hover:bg-surface-container-low/80" data-devolucion-id="${escapeHtml(item.id)}">
        <td class="inv-sticky-sku px-1.5 py-1.5 align-middle border-r border-surface-container-high whitespace-nowrap">
          <span class="font-code-sm text-code-sm font-bold text-on-surface">${escapeHtml(sku)}</span>
        </td>
        <td class="px-1 py-1.5 align-middle text-center whitespace-nowrap">
          <span class="font-code-md text-code-md font-black text-on-surface tabular-nums">1</span>
        </td>
        <td class="px-1.5 py-1.5 align-middle whitespace-nowrap text-right">
          <span class="font-code-sm text-code-sm font-bold text-on-surface tabular-nums">${escapeHtml(unitTxt)}</span>
        </td>
        <td class="px-1.5 py-1.5 align-middle whitespace-nowrap">
          <span class="inline-flex items-center rounded-md bg-primary-fixed text-on-primary-fixed px-1.5 py-0.5 font-code-sm text-code-sm font-bold">${escapeHtml(tienda)}</span>
        </td>
        <td class="px-1.5 py-1.5 align-middle min-w-[110px]">
          <span class="font-label-sm text-label-sm text-on-surface font-semibold">${escapeHtml(estatus)}</span>
        </td>
      </tr>`;
    })
    .join('');

  const registrosLabel = `${items.length} registro${items.length === 1 ? '' : 's'}`;
  const imgThumbUrl = productoImagenUrl(codigo, { thumb: true });
  const imgFullUrl = productoImagenUrl(codigo);

  list.innerHTML = `
    <div class="shrink-0 px-gutter pb-3 flex flex-col gap-2">
      <nav class="flex items-center gap-1.5 min-w-0" aria-label="Navegación inventario">
        <button type="button" id="invVolverConsolidado" class="shrink-0 h-8 px-2 rounded-lg text-primary hover:bg-primary-fixed/40 inline-flex items-center gap-1 font-label-sm text-label-sm font-bold">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
          Consolidado
        </button>
        <span class="material-symbols-outlined text-[16px] text-outline shrink-0">chevron_right</span>
        <span class="font-label-sm text-label-sm text-on-surface-variant font-semibold truncate">Detalle</span>
      </nav>
      <div class="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 flex items-start gap-3">
        <button type="button" id="invDetalleImgBtn" class="shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-outline-variant bg-surface-container-high flex items-center justify-center disabled:opacity-60" ${imgThumbUrl ? '' : 'disabled'} aria-label="Ver imagen completa" title="${imgThumbUrl ? 'Ver imagen completa' : 'Sin imagen'}">
          <span id="invDetalleImgPlaceholder" class="material-symbols-outlined text-[28px] text-on-surface-variant">image</span>
          ${
            imgThumbUrl
              ? `<img id="invDetalleImg" alt="${escapeHtml(codigo)}" class="hidden w-full h-full object-cover" decoding="async" fetchpriority="high" />`
              : ''
          }
        </button>
        <div class="min-w-0 flex-1">
          <p class="font-label-sm text-label-sm text-on-surface-variant font-semibold uppercase tracking-wide mb-0.5">Código de producto</p>
          <h2 id="invDetalleTitulo" class="font-code-md text-[18px] leading-6 font-black text-on-surface tracking-tight">${escapeHtml(codigo)}</h2>
          <p class="mt-1 font-label-md text-label-md text-on-surface font-medium leading-snug">${escapeHtml(desc)}</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="font-label-sm text-label-sm text-on-surface-variant font-semibold uppercase tracking-wide mb-0.5">Cant.</p>
          <p class="font-code-md text-[18px] leading-6 font-black text-on-surface tabular-nums">${items.length}</p>
          <p class="mt-0.5 font-label-sm text-label-sm text-on-surface-variant">${registrosLabel}</p>
        </div>
      </div>
    </div>
    <div id="inventarioTableWrap" class="flex-1 min-h-0 m-0 p-0 border-y border-outline-variant bg-surface-container-lowest overflow-hidden flex flex-col">
      <div class="inv-table-scroll m-0 p-0" id="inventarioTableScroll">
        <table class="w-full min-w-[640px] border-collapse text-left m-0" id="inventarioDataTable">
          <thead>
            <tr class="bg-surface-container">
              <th class="inv-sticky-sku px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide border-r border-surface-container-high leading-tight">Código de barra</th>
              <th class="px-1 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide text-center whitespace-nowrap">Cant.</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap text-right">Costo/u</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap">Tienda</th>
              <th class="px-1.5 py-1.5 font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide whitespace-nowrap">Estatus</th>
            </tr>
          </thead>
          <tbody class="bg-surface-container-lowest">
            ${rows || `<tr><td colspan="5" class="p-4 text-center text-on-surface-variant font-body-sm text-body-sm">Sin registros</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('invVolverConsolidado')?.addEventListener('click', () => {
    volverConsolidadoInventario();
  });

  const detalleImg = document.getElementById('invDetalleImg');
  const detalleImgBtn = document.getElementById('invDetalleImgBtn');
  const detallePlaceholder = document.getElementById('invDetalleImgPlaceholder');
  if (detalleImg && detalleImgBtn && imgThumbUrl) {
    const showDetalleImg = (ok) => {
      if (ok) {
        detalleImg.classList.remove('hidden');
        detallePlaceholder?.classList.add('hidden');
        detalleImgBtn.disabled = false;
      } else {
        detalleImg.classList.add('hidden');
        detallePlaceholder?.classList.remove('hidden');
        detalleImgBtn.disabled = true;
      }
    };
    detalleImg.addEventListener('load', () => showDetalleImg(true));
    detalleImg.addEventListener('error', () => showDetalleImg(false));
    detalleImgBtn.addEventListener('click', () => {
      if (detalleImgBtn.disabled) return;
      openImagenLightbox(imgFullUrl, codigo);
    });
    // Thumb pequeño para card; full solo al abrir lightbox
    detalleImg.src = imgThumbUrl;
  }
}

async function descargarReporteInventario() {
  const btn = document.getElementById('inventarioExcelBtn');
  if (btn) btn.disabled = true;
  try {
    const url = api.devoluciones.inventarioExcelUrl({
      q: state.inventario.q,
      sucursalId: state.inventario.sucursalId,
      estatusId: state.inventario.estatusId,
    });
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Error HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(cd);
    const filename = match?.[1] || 'reporte-inventario.xlsx';
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    showToast('Reporte Excel descargado.');
  } catch (err) {
    showToast(err.message || 'No se pudo descargar el reporte.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderInventarioView() {
  document.body.classList.add('inv-lock-scroll');
  app.innerHTML = `
  <main class="flex-1 flex flex-col relative w-full min-h-0 overflow-hidden bg-surface pt-4 pt-safe">
    <div class="shrink-0 px-gutter pb-space-sm flex flex-col gap-space-sm">
      <div class="bg-surface-container rounded-xl p-2.5 flex flex-col gap-2 shadow-sm">
        <div class="flex items-center gap-1.5 bg-surface-container-lowest rounded-lg p-1">
          <span class="material-symbols-outlined text-[20px] text-on-surface-variant ml-1">search</span>
          <input id="inventarioSearch" class="flex-1 bg-transparent font-body-md text-body-md text-on-surface px-1 h-9 focus:outline-none min-w-0" placeholder="Buscar..." type="search" value="${escapeHtml(state.inventario.q)}" />
          <button type="button" id="inventarioExcelBtn" class="h-9 px-2.5 rounded-lg bg-primary text-on-primary inline-flex items-center gap-1 shrink-0 font-label-sm text-label-sm font-bold" aria-label="Descargar reporte Excel">
            <span class="material-symbols-outlined text-[18px]">download</span>
            <span>Excel</span>
          </button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${pickerHtml({ key: 'invTienda', icon: 'storefront', placeholder: 'Todas las tiendas', modal: true })}
          ${pickerHtml({ key: 'invEstatus', icon: 'filter_list', placeholder: 'Todos los estatus' })}
        </div>
      </div>
    </div>

    <div id="inventarioList" class="flex-1 min-h-0 w-full m-0 flex flex-col overflow-hidden pb-[7.5rem]"></div>

    <div id="inventarioTotalesBar" class="fixed bottom-16 inset-x-0 z-40 border-t border-outline-variant bg-surface-container-lowest shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
      <div class="h-11 flex items-stretch text-on-surface">
        <div class="inv-excel-total-label shrink-0 flex items-center justify-center px-2 border-r border-surface-container-high font-label-sm text-label-sm font-black bg-surface-container-lowest">Total</div>
        <div class="flex-1 flex items-center justify-end gap-3 px-3 border-r border-surface-container-low bg-surface-container-lowest min-w-0">
          <span class="font-label-sm text-label-sm text-on-surface-variant shrink-0">Costo</span>
          <span id="totalCosto" class="font-code-md text-code-md font-black tabular-nums text-primary truncate">${formatCosto(state.inventario.totales.costo || 0)}</span>
        </div>
        <div class="inv-excel-total-value shrink-0 min-w-[4.5rem] flex items-center justify-center px-3 border-l border-surface-container-high font-code-md text-code-md font-black tabular-nums bg-surface-container-lowest">
          <span id="totalCantidad">${state.inventario.totales.registros || 0}</span>
        </div>
      </div>
    </div>

    ${toastHtml()}
    ${tiendaModalHtml()}
    ${editDevolucionModalHtml()}
    ${imagenLightboxHtml()}
  </main>
  ${navHtml()}
  `;

  renderInvTiendaSelect();
  renderInvEstatusSelect();
  bindInventarioEvents();
  bindTiendaModalEvents();
  bindEditDevolucionEvents();
  bindImagenLightboxEvents();
  loadInventario();
  if (!state.sucursales.length || !state.estatus.length) {
    loadCatalogos()
      .then(() => {
        if (state.view === 'inventario') {
          renderInvTiendaSelect();
          renderInvEstatusSelect();
        }
      })
      .catch(() => {});
  }
}

function renderInventarioTotalesRow() {
  // "Total" = conteo de escaneos + suma de costo unitario guardado por escaneo
  const value = String(state.inventario.totales.registros || 0);
  const totalCant = document.getElementById('totalCantidad');
  if (totalCant) totalCant.textContent = value;
  const totalCosto = document.getElementById('totalCosto');
  if (totalCosto) {
    const items = state.inventario.items || [];
    const costo =
      state.inventario.totales.costo ??
      items.reduce((sum, it) => sum + itemCurrCost(it), 0);
    totalCosto.textContent = formatCosto(costo);
  }
}

function bindInventarioEvents() {
  const search = document.getElementById('inventarioSearch');
  let timer = null;

  search?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.inventario.q = search.value.trim();
      state.inventario.vista = 'consolidado';
      state.inventario.detalleCodigo = null;
      loadInventario();
    }, 250);
  });

  document.getElementById('inventarioExcelBtn')?.addEventListener('click', () => {
    descargarReporteInventario();
  });

  document.getElementById('invTiendaTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openTiendaModal('inventario');
  });
  document.getElementById('invEstatusTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu('invEstatus');
  });
  document.addEventListener('click', onDocumentClickCloseMenus);
}

/* ---------------- Triage view ---------------- */

function renderTriageView() {
  document.body.classList.remove('inv-lock-scroll');
  app.innerHTML = `
  <main class="flex-1 flex flex-col relative w-full pb-24 bg-surface pt-4 pt-safe">
    <div class="flex flex-col w-full">
      <div class="px-gutter pb-space-sm flex flex-col gap-1.5">
        <button
          type="button"
          id="cameraToggle"
          class="w-full h-10 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high border border-outline-variant flex items-center justify-center gap-2 font-label-md text-label-md"
          aria-pressed="${state.cameraOn ? 'true' : 'false'}"
        >
          <span class="material-symbols-outlined text-[20px]" id="cameraToggleIcon">${state.cameraOn ? 'videocam_off' : 'photo_camera'}</span>
          <span id="cameraToggleLabel">${state.cameraOn ? 'Desactivar cámara' : 'Activar escaneo por cámara'}</span>
        </button>
        <div id="cameraPanel" class="${state.cameraOn ? 'flex' : 'hidden'} flex-col gap-1.5">
          <div class="flex items-center justify-end gap-1.5">
            <button class="w-8 h-8 rounded-full bg-surface-container text-on-surface flex items-center justify-center" id="flashToggle" type="button" aria-label="Flash">
              <span class="material-symbols-outlined text-[18px]">flash_on</span>
            </button>
            <button class="w-8 h-8 rounded-full bg-surface-container text-on-surface flex items-center justify-center" id="beepToggle" type="button" aria-label="Sonido">
              <span class="material-symbols-outlined text-[18px]">volume_up</span>
            </button>
          </div>
          <div class="relative w-full h-[160px] rounded-xl bg-inverse-surface overflow-hidden shadow-md barcode-scanner-slot">
            <div id="scannerRegion" class="absolute inset-0 z-[1]"></div>
            <div id="barcodeGuide" class="hidden barcode-guide pointer-events-none z-[3]" aria-hidden="true">
              <span class="barcode-guide-corner tl"></span>
              <span class="barcode-guide-corner tr"></span>
              <span class="barcode-guide-corner bl"></span>
              <span class="barcode-guide-corner br"></span>
              <span class="barcode-guide-laser"></span>
            </div>
            <div id="scannerHintBar" class="hidden absolute inset-x-2 bottom-1 z-10 items-center justify-center bg-inverse-surface/90 backdrop-blur-sm py-0.5 px-2 rounded-md gap-1">
              <span class="material-symbols-outlined text-primary-fixed text-[14px]">qr_code_scanner</span>
              <span id="scannerHint" class="font-body-sm text-body-sm text-inverse-on-surface font-medium"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="px-gutter pb-space-sm">
        <div class="bg-surface-container p-2.5 rounded-xl flex flex-col gap-1.5 shadow-sm">
          <div class="flex items-center gap-1.5 bg-surface-container-lowest rounded-lg p-1">
            <button class="w-9 h-9 rounded-DEFAULT bg-surface-container text-on-surface flex items-center justify-center shrink-0" type="button" id="focusInputBtn" aria-label="Teclado">
              <span class="material-symbols-outlined text-[20px]">dialpad</span>
            </button>
            <input class="flex-1 bg-transparent font-code-md text-code-md text-on-surface px-1 focus:outline-none min-w-0 font-semibold" id="barcodeInput" placeholder="Código de barra..." type="text" value="" autocomplete="off" aria-label="Código de barra" />
            <button class="w-7 h-7 rounded-full text-secondary hover:text-on-surface flex items-center justify-center shrink-0" id="clearInputBtn" type="button" aria-label="Limpiar">
              <span class="material-symbols-outlined text-[18px]">cancel</span>
            </button>
            <button id="buscarBtn" class="bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md px-3 h-9 rounded-lg flex items-center gap-1 shrink-0" type="button">
              <span>Buscar</span>
            </button>
          </div>
        </div>
      </div>

      <div class="px-gutter pb-space-sm">
        <div id="productoEmpty" class="hidden"></div>

        <div id="productoCard" class="hidden bg-surface-container-lowest rounded-xl p-space-sm shadow-sm flex-col gap-3">
          <div class="flex items-center justify-between pb-1 border-b-2 border-surface-container-low">
            <span class="font-label-sm text-label-sm text-primary font-bold">Producto</span>
          </div>

          <div class="flex items-center gap-space-sm">
            <div class="w-16 h-16 rounded-lg bg-surface-container-high border border-outline-variant flex flex-col items-center justify-center shrink-0 text-primary shadow-sm">
              <span class="material-symbols-outlined text-[28px]">precision_manufacturing</span>
            </div>
            <div class="flex flex-col min-w-0 flex-1">
              <span id="productoNombre" class="font-headline-sm text-headline-sm text-on-surface truncate"></span>
              <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                <span class="font-code-sm text-code-sm text-on-surface-variant font-medium">Código de producto <span id="productoArticulo"></span></span>
                <span class="font-code-sm text-code-sm bg-surface-container px-1.5 py-0.5 rounded-DEFAULT text-on-secondary-container" id="productoCodigoBarra"></span>
              </div>
              <div class="flex items-center gap-1 text-on-surface-variant mt-1">
                <span class="material-symbols-outlined text-[15px] text-tertiary">inventory_2</span>
                <span class="font-body-sm text-body-sm truncate">
                  Cantidad: <span id="productoCantidad"></span> <span id="productoUdm"></span>
                </span>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-2.5 pt-1 border-t border-surface-container-low">
            <div class="flex flex-col gap-1">
              <label class="font-label-sm text-label-sm text-on-surface-variant font-semibold flex items-center justify-between">
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-primary text-[16px]">store</span>
                  Tienda <span class="text-error">*</span>
                </span>
                <span id="bahiaHint" class="font-code-sm text-code-sm text-secondary font-normal">—</span>
              </label>
              ${pickerHtml({ key: 'tienda', icon: 'store', placeholder: 'Seleccionar tienda', modal: true })}
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between gap-2">
                <label class="font-label-sm text-label-sm text-on-surface-variant font-semibold flex items-center gap-1">
                  <span class="material-symbols-outlined text-primary text-[16px]">assignment_return</span>
                  Estatus <span class="text-error">*</span>
                </label>
                <button type="button" id="addNewStatusBtn" class="h-8 px-2 rounded-lg bg-surface-container text-primary hover:bg-surface-container-high border border-outline-variant flex items-center gap-1 font-label-sm text-label-sm">
                  <span class="material-symbols-outlined text-[18px]">add_circle</span>
                  <span class="font-semibold">Nuevo</span>
                </button>
              </div>
              ${pickerHtml({ key: 'status', icon: 'report', placeholder: 'Seleccionar estatus' })}
            </div>
          </div>

          <button class="w-full h-12 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-headline-sm text-headline-sm flex items-center justify-center gap-2 shadow-md mt-1" id="saveActionBtn" type="button">
            <span class="material-symbols-outlined text-[22px]">check_circle</span>
            <span>Registrar</span>
          </button>
          <button class="w-full h-9 rounded-lg bg-surface-container text-on-surface hover:bg-surface-container-high font-label-md text-label-md flex items-center justify-center gap-1.5" id="discardActionBtn" type="button">
            <span class="material-symbols-outlined text-[16px]">restart_alt</span>
            <span>Limpiar</span>
          </button>
        </div>
      </div>

      <div class="w-full m-0 p-0 flex flex-col gap-2">
        <div class="px-gutter flex items-center justify-between gap-2">
          <div class="min-w-0">
            <span class="font-headline-sm text-headline-sm text-on-surface">Escaneados</span>
            <p class="font-label-sm text-label-sm text-on-surface-variant">Todos · del último al primero</p>
          </div>
          <span id="historialCount" class="bg-primary-fixed text-on-primary-fixed font-code-sm text-code-sm px-2 py-0.5 rounded-full font-semibold shrink-0">0</span>
        </div>
        <div id="historialList" class="w-full m-0 p-0"></div>
      </div>

      ${toastHtml()}
      ${estatusModalHtml()}
      ${tiendaModalHtml()}
      ${editDevolucionModalHtml()}
    </div>
  </main>
  ${navHtml()}
  `;

  bindTriageEvents();
  bindEditDevolucionEvents();
  fillSelects();
  renderHistorial();
  renderProductoCard();
  if (state.cameraOn) startScanner();
}

/**
 * Pistola Bluetooth (HID): no tipean el input.
 * Acumulan en silencio → al terminar buscan el código y muestran el producto.
 * Idle > latencia típica BT (~60–100ms) para no soltar tecla a tecla.
 */
const WEDGE_IDLE_MS = 150;
const WEDGE_MIN_LEN = 6;

function clearWedgeTimer() {
  if (state.wedge.timer) {
    clearTimeout(state.wedge.timer);
    state.wedge.timer = null;
  }
}

function wedgeTargetInput() {
  const editModal = document.getElementById('editDevolucionModal');
  const editOpen =
    editModal &&
    !editModal.classList.contains('hidden') &&
    editModal.classList.contains('flex');
  if (editOpen) return document.getElementById('editCodigo');
  return document.getElementById('barcodeInput');
}

/** Escaneo pistola: busca producto sin llenar el formulario (eso es solo manual) */
function flushWedgeBuffer(source = 'idle') {
  clearWedgeTimer();
  const codigo = String(state.wedge.buffer || '').trim();
  state.wedge.buffer = '';
  if (codigo.length < WEDGE_MIN_LEN) return;

  const input = wedgeTargetInput();
  document.getElementById('barcodeInput')?.blur();
  if (input?.id === 'editCodigo') {
    input.value = codigo;
    buscarCodigoEnEdit();
  } else {
    buscarProducto(codigo, { fillInput: false });
  }
}

function onBluetoothWedgeKeydown(e) {
  if (state.view !== 'triage' && state.view !== 'inventario') return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const target = e.target;
  const tag = target?.tagName;
  const isCodeField =
    target?.id === 'barcodeInput' || target?.id === 'editCodigo';
  const isOtherField =
    /^(INPUT|TEXTAREA|SELECT)$/.test(tag || '') && !isCodeField;
  if (isOtherField) return;

  // Formulario = ingreso manual: si el usuario enfocó el input, tipéa normal
  if (isCodeField) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = String(target.value || '').trim();
      if (!value) return;
      if (target.id === 'editCodigo') buscarCodigoEnEdit();
      else buscarProducto(value, { fillInput: true });
    }
    return;
  }

  // Pistola sin foco en el form: captura global → busca producto
  if (e.key === 'Enter') {
    e.preventDefault();
    if (state.wedge.buffer.length >= WEDGE_MIN_LEN) flushWedgeBuffer('enter');
    return;
  }

  if (e.key.length !== 1) return;

  e.preventDefault();
  e.stopPropagation();
  state.wedge.buffer += e.key;
  state.wedge.lastAt = Date.now();
  clearWedgeTimer();
  state.wedge.timer = setTimeout(() => {
    if (state.wedge.buffer.length >= WEDGE_MIN_LEN) flushWedgeBuffer('idle');
    else state.wedge.buffer = '';
  }, WEDGE_IDLE_MS);
}

function bindBluetoothScanner() {
  if (state.wedge.bound) return;
  document.addEventListener('keydown', onBluetoothWedgeKeydown, true);
  state.wedge.bound = true;
}

function updateCameraToggleUi() {
  const btn = document.getElementById('cameraToggle');
  const icon = document.getElementById('cameraToggleIcon');
  const label = document.getElementById('cameraToggleLabel');
  const panel = document.getElementById('cameraPanel');
  if (btn) btn.setAttribute('aria-pressed', state.cameraOn ? 'true' : 'false');
  if (icon) icon.textContent = state.cameraOn ? 'videocam_off' : 'photo_camera';
  if (label) {
    label.textContent = state.cameraOn
      ? 'Desactivar cámara'
      : 'Activar escaneo por cámara';
  }
  if (panel) {
    panel.classList.toggle('hidden', !state.cameraOn);
    panel.classList.toggle('flex', state.cameraOn);
  }
  btn?.classList.toggle('bg-primary-fixed', state.cameraOn);
  btn?.classList.toggle('text-on-primary-fixed', state.cameraOn);
  btn?.classList.toggle('border-primary', state.cameraOn);
}

async function toggleCameraScan() {
  state.cameraOn = !state.cameraOn;
  localStorage.setItem('triageCameraOn', state.cameraOn ? '1' : '0');
  updateCameraToggleUi();
  if (state.cameraOn) {
    await startScanner();
  } else {
    const guide = document.getElementById('barcodeGuide');
    guide?.classList.add('hidden');
    await stopScanner();
  }
}

function bindTriageEvents() {
  bindBluetoothScanner();
  // Pistola no necesita foco; el input es solo para tipeo manual (botón teclado)

  document.getElementById('cameraToggle')?.addEventListener('click', () => {
    toggleCameraScan();
  });

  document.getElementById('flashToggle')?.addEventListener('click', (e) => {
    state.flashOn = !state.flashOn;
    const btn = e.currentTarget;
    const icon = btn.querySelector('span');
    if (icon) icon.textContent = state.flashOn ? 'flash_off' : 'flash_on';
    btn.classList.toggle('bg-primary-container', state.flashOn);
    btn.classList.toggle('text-on-primary', state.flashOn);
  });

  document.getElementById('beepToggle')?.addEventListener('click', (e) => {
    state.muted = !state.muted;
    const icon = e.currentTarget.querySelector('span');
    if (icon) icon.textContent = state.muted ? 'volume_off' : 'volume_up';
  });

  document.getElementById('clearInputBtn')?.addEventListener('click', () => {
    const input = document.getElementById('barcodeInput');
    if (input) {
      input.value = '';
      input.focus();
    }
  });

  document.getElementById('focusInputBtn')?.addEventListener('click', () => {
    document.getElementById('barcodeInput')?.focus();
  });

  document.getElementById('buscarBtn')?.addEventListener('click', () => {
    buscarProducto(document.getElementById('barcodeInput')?.value, {
      fillInput: true,
    });
  });

  // Enter en input lo maneja onBluetoothWedgeKeydown (capture)

  document.getElementById('tiendaTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openTiendaModal('triage');
  });
  document.getElementById('statusTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu('status');
  });
  document.addEventListener('click', onDocumentClickCloseMenus);

  document.getElementById('addNewStatusBtn')?.addEventListener('click', openEstatusModal);
  document.getElementById('closeEstatusModalBtn')?.addEventListener('click', closeEstatusModal);
  document.getElementById('cancelEstatusBtn')?.addEventListener('click', closeEstatusModal);
  document.getElementById('confirmEstatusBtn')?.addEventListener('click', confirmarNuevoEstatus);
  document.getElementById('estatusModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'estatusModal') closeEstatusModal();
  });
  document.getElementById('nuevoEstatusNombre')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmarNuevoEstatus();
    }
    if (e.key === 'Escape') closeEstatusModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.tiendaModalMode) closeTiendaModal();
  });

  bindTiendaModalEvents();
  document.getElementById('saveActionBtn')?.addEventListener('click', guardarDevolucion);
  document.getElementById('discardActionBtn')?.addEventListener('click', nuevoEscaneo);
}

function onDocumentClickCloseMenus(e) {
  if (!state.openMenu) return;
  const wrap = document.querySelector(`[data-picker="${state.openMenu}"]`);
  if (wrap && wrap.contains(e.target)) return;
  closeAllMenus();
}

/* ---------------- Carga de imágenes ---------------- */

async function loadImagenesProductos() {
  state.imagenes.loading = true;
  renderImagenesList();
  try {
    const data = await api.productoImagenes.list({ q: state.imagenes.q });
    state.imagenes.items = data.items || [];
    state.imagenes.totales = data.totales || {
      codigos: 0,
      conImagen: 0,
      sinImagen: 0,
    };
  } catch (err) {
    showToast(err.message || 'No se pudo cargar códigos');
    state.imagenes.items = [];
    state.imagenes.totales = { codigos: 0, conImagen: 0, sinImagen: 0 };
  } finally {
    state.imagenes.loading = false;
    renderImagenesList();
    const nav = document.getElementById('navImagenesCount');
    if (nav) nav.textContent = String(state.imagenes.totales.codigos || 0);
  }
}

function renderImagenesTotales() {
  const con = document.getElementById('imgTotalCon');
  const sin = document.getElementById('imgTotalSin');
  const all = document.getElementById('imgTotalCodigos');
  if (con) con.textContent = String(state.imagenes.totales.conImagen || 0);
  if (sin) sin.textContent = String(state.imagenes.totales.sinImagen || 0);
  if (all) all.textContent = String(state.imagenes.totales.codigos || 0);
}

function renderImagenesList() {
  const list = document.getElementById('imagenesList');
  renderImagenesTotales();
  if (!list) return;

  if (state.imagenes.loading) {
    list.innerHTML = `<div class="p-4 text-center text-on-surface-variant font-body-sm text-body-sm">Cargando códigos...</div>`;
    return;
  }

  if (!state.imagenes.items.length) {
    list.innerHTML = `<div class="p-4 text-center text-on-surface-variant font-body-sm text-body-sm">Sin códigos únicos para mostrar</div>`;
    return;
  }

  const cards = state.imagenes.items
    .map((item) => {
      const uploading = state.imagenes.uploadingCodigo === item.codigo;
      const mode = uploading ? state.imagenes.uploadingMode : null;
      const thumb = item.tieneImagen && item.imagenUrl
        ? `<img src="${escapeHtml(item.imagenUrl)}" alt="${escapeHtml(item.codigo)}" class="w-full h-full object-cover" loading="lazy" />`
        : `<span class="material-symbols-outlined text-[36px] text-on-surface-variant">image</span>`;
      return `
      <article class="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden flex flex-col" data-codigo="${escapeHtml(item.codigo)}">
        <div class="aspect-square bg-surface-container flex items-center justify-center overflow-hidden relative">
          ${thumb}
          ${
            item.tieneImagen
              ? `<span class="absolute top-1.5 right-1.5 h-6 px-1.5 rounded-md bg-primary text-on-primary font-label-sm text-[10px] font-bold inline-flex items-center">OK</span>`
              : `<span class="absolute top-1.5 right-1.5 h-6 px-1.5 rounded-md bg-surface-container-high text-on-surface-variant font-label-sm text-[10px] font-bold inline-flex items-center">Sin img</span>`
          }
        </div>
        <div class="p-2.5 flex flex-col gap-1.5 flex-1">
          <div class="min-w-0">
            <p class="font-code-sm text-code-sm font-black text-on-surface truncate">${escapeHtml(item.codigo)}</p>
            <p class="font-label-sm text-label-sm text-on-surface-variant line-clamp-2 leading-snug">${escapeHtml(item.descripcion)}</p>
            <p class="font-label-sm text-[10px] text-on-surface-variant mt-0.5">Barra: ${escapeHtml(item.codigoBarra)} · Cant. ${escapeHtml(item.cantidad)}</p>
          </div>
          <div class="mt-auto grid grid-cols-2 gap-1.5">
            <label class="h-9 rounded-lg bg-surface-container-high text-on-surface border border-outline-variant inline-flex items-center justify-center gap-0.5 font-label-sm text-[11px] font-bold cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}">
              <span class="material-symbols-outlined text-[15px]">${mode === 'original' ? 'hourglass_top' : 'upload'}</span>
              <span>${mode === 'original' ? 'Subiendo…' : 'Subir'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden imgUploadOriginal" data-codigo="${escapeHtml(item.codigo)}" ${uploading ? 'disabled' : ''} />
            </label>
            <button type="button" class="imgEnhanceBtn h-9 rounded-lg bg-primary text-on-primary inline-flex items-center justify-center gap-0.5 font-label-sm text-[11px] font-bold ${uploading || !item.tieneImagen ? 'opacity-60' : ''}" data-codigo="${escapeHtml(item.codigo)}" ${uploading || !item.tieneImagen ? 'disabled' : ''} title="${item.tieneImagen ? 'Mejorar la imagen ya subida' : 'Primero sube una imagen'}">
              <span class="material-symbols-outlined text-[15px]">${mode === 'ai' ? 'hourglass_top' : 'auto_fix_high'}</span>
              <span>${mode === 'ai' ? 'IA…' : 'IA'}</span>
            </button>
          </div>
          ${
            item.tieneImagen
              ? `<button type="button" class="imgDeleteBtn h-8 w-full rounded-lg bg-error-container/40 text-error inline-flex items-center justify-center gap-1 font-label-sm text-label-sm font-bold" data-codigo="${escapeHtml(item.codigo)}" ${uploading ? 'disabled' : ''}>
                   <span class="material-symbols-outlined text-[16px]">delete</span>
                   Quitar imagen
                 </button>`
              : ''
          }
        </div>
      </article>`;
    })
    .join('');

  list.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 px-gutter pb-28">${cards}</div>`;

  list.querySelectorAll('.imgUploadOriginal').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      const codigo = input.dataset.codigo;
      input.value = '';
      if (!file || !codigo) return;
      await subirImagenProducto(codigo, file);
    });
  });

  list.querySelectorAll('.imgEnhanceBtn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const codigo = btn.dataset.codigo;
      if (!codigo) return;
      await mejorarImagenProducto(codigo);
    });
  });

  list.querySelectorAll('.imgDeleteBtn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const codigo = btn.dataset.codigo;
      if (!codigo) return;
      if (!window.confirm(`¿Quitar la imagen de ${codigo}?`)) return;
      try {
        await api.productoImagenes.remove(codigo);
        showToast('Imagen eliminada');
        await loadImagenesProductos();
      } catch (err) {
        showToast(err.message || 'No se pudo eliminar');
      }
    });
  });
}

async function subirImagenProducto(codigo, file) {
  state.imagenes.uploadingCodigo = codigo;
  state.imagenes.uploadingMode = 'original';
  renderImagenesList();
  try {
    await api.productoImagenes.upload(codigo, file);
    showToast(`Original guardada · ${codigo}`);
    await loadImagenesProductos();
  } catch (err) {
    showToast(err.message || 'No se pudo subir la imagen');
  } finally {
    state.imagenes.uploadingCodigo = null;
    state.imagenes.uploadingMode = null;
    renderImagenesList();
  }
}

function openEnhancePreviewModal({ codigo, originalUrl, previewUrl, enhanceMethod }) {
  state.imagenes.enhancePreview = { codigo, originalUrl, previewUrl, enhanceMethod };
  const modal = document.getElementById('enhancePreviewModal');
  const orig = document.getElementById('enhancePreviewOriginal');
  const ai = document.getElementById('enhancePreviewAi');
  const title = document.getElementById('enhancePreviewTitle');
  const methodEl = document.getElementById('enhancePreviewMethod');
  if (title) title.textContent = `¿Usar la mejora IA? · ${codigo}`;
  if (methodEl) methodEl.textContent = enhanceMethod ? `Método: ${enhanceMethod}` : '';
  if (orig) orig.src = originalUrl || '';
  if (ai) ai.src = previewUrl || '';
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

async function closeEnhancePreviewModal({ discard = false } = {}) {
  const preview = state.imagenes.enhancePreview;
  const modal = document.getElementById('enhancePreviewModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  const blank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const orig = document.getElementById('enhancePreviewOriginal');
  const ai = document.getElementById('enhancePreviewAi');
  if (orig) orig.src = blank;
  if (ai) ai.src = blank;
  state.imagenes.enhancePreview = null;
  if (discard && preview?.codigo) {
    try {
      await api.productoImagenes.discardEnhance(preview.codigo);
    } catch {
      /* ignore */
    }
  }
}

async function acceptEnhancePreview() {
  const preview = state.imagenes.enhancePreview;
  if (!preview?.codigo) return;
  const codigo = preview.codigo;
  try {
    await api.productoImagenes.acceptEnhance(codigo);
    showToast(`Imagen IA aplicada · ${codigo}`);
    await closeEnhancePreviewModal({ discard: false });
    await loadImagenesProductos();
  } catch (err) {
    showToast(err.message || 'No se pudo aplicar la imagen IA');
  }
}

async function mejorarImagenProducto(codigo) {
  state.imagenes.uploadingCodigo = codigo;
  state.imagenes.uploadingMode = 'ai';
  const started = Date.now();
  let progressTimer = null;
  const tickProgress = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    const btn = document.querySelector(`.imgEnhanceBtn[data-codigo="${CSS.escape(codigo)}"] span:last-child`);
    if (btn && state.imagenes.uploadingCodigo === codigo) {
      btn.textContent = `IA ${secs}s…`;
    }
  };
  renderImagenesList();
  tickProgress();
  progressTimer = setInterval(tickProgress, 1000);
  try {
    const result = await api.productoImagenes.enhance(codigo);
    state.imagenes.uploadingCodigo = null;
    state.imagenes.uploadingMode = null;
    clearInterval(progressTimer);
    progressTimer = null;
    renderImagenesList();
    if (state.view !== 'imagenes') {
      state.imagenes.enhancePreview = {
        codigo,
        originalUrl: result.originalUrl,
        previewUrl: result.previewUrl,
        enhanceMethod: result.enhanceMethod,
      };
      showToast(`IA lista · vuelve a Carga img para decidir · ${codigo}`);
      return;
    }
    openEnhancePreviewModal({
      codigo,
      originalUrl: result.originalUrl,
      previewUrl: result.previewUrl,
      enhanceMethod: result.enhanceMethod,
    });
    if (!document.getElementById('enhancePreviewModal')) {
      showToast('Preview lista pero no se pudo abrir el modal');
    }
  } catch (err) {
    showToast(err.message || 'No se pudo mejorar la imagen');
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    state.imagenes.uploadingCodigo = null;
    state.imagenes.uploadingMode = null;
    if (state.view === 'imagenes' && !document.getElementById('enhancePreviewModal')?.classList.contains('flex')) {
      renderImagenesList();
    }
  }
}

function updateGoogleJobUi(job) {
  const el = document.getElementById('imagenesGoogleJob');
  const btn = document.getElementById('imagenesGoogleBtn');
  const label = document.getElementById('imagenesGoogleBtnLabel');
  if (!el) return;
  if (!job || job.status === 'idle') {
    el.classList.add('hidden');
    if (btn && state.imagenes.apifyConfigured) btn.disabled = false;
    if (label) label.textContent = 'Buscar Google (sin img)';
    return;
  }
  el.classList.remove('hidden');
  const t = job.totales || {};
  if (job.status === 'running') {
    el.textContent = `Google Apify… productos ${t.productos || 0} · aplicadas ${t.aplicadas || 0} · con resultados ${t.conResultados || 0}`;
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Buscando Google…';
  } else if (job.status === 'done') {
    el.textContent = `Listo: ${t.aplicadas || 0} aplicadas · ${t.conResultados || 0} con resultados · ${t.errores || 0} errores`;
    if (btn && state.imagenes.apifyConfigured) btn.disabled = false;
    if (label) label.textContent = 'Buscar Google (sin img)';
  } else if (job.status === 'error') {
    el.textContent = `Error Google: ${job.error || 'falló'}`;
    el.classList.add('text-error');
    if (btn && state.imagenes.apifyConfigured) btn.disabled = false;
    if (label) label.textContent = 'Buscar Google (sin img)';
  }
}

async function startBusquedaGoogleMasiva() {
  if (!state.imagenes.apifyConfigured) {
    showToast('Falta APIFY_TOKEN en backend/.env');
    return;
  }
  if (!window.confirm('¿Buscar en Google Images (Apify) una foto para cada producto SIN imagen y aplicarla automáticamente?')) {
    return;
  }
  try {
    const started = await api.productoImagenes.buscarGoogle({
      soloSinImagen: true,
      maxPorProducto: 5,
      aplicarPrimera: true,
      q: state.imagenes.q || '',
    });
    if (started.status === 'idle') {
      showToast(started.message || 'Nada que buscar');
      return;
    }
    showToast('Búsqueda Google iniciada…');
    updateGoogleJobUi({ status: 'running', totales: started.totales || {} });

    const poll = async () => {
      const job = await api.productoImagenes.buscarGoogleJob();
      state.imagenes.googleJob = job;
      updateGoogleJobUi(job);
      if (job.status === 'running') {
        setTimeout(poll, 2000);
        return;
      }
      if (job.status === 'done') {
        showToast(
          `Google: ${job.totales?.aplicadas || 0} fotos aplicadas de ${job.totales?.productos || 0}`
        );
        await loadImagenesProductos();
      } else if (job.status === 'error') {
        showToast(job.error || 'Falló búsqueda Google');
      }
    };
    setTimeout(poll, 1500);
  } catch (err) {
    showToast(err.message || 'No se pudo iniciar Google');
    updateGoogleJobUi({ status: 'idle' });
  }
}

function renderImagenesView() {
  document.body.classList.remove('inv-lock-scroll');
  app.innerHTML = `
  <main class="flex-1 flex flex-col relative w-full min-h-0 bg-surface pt-4 pt-safe pb-20">
    <div class="shrink-0 px-gutter pb-space-sm flex flex-col gap-2">
      <div class="flex items-start gap-2">
        <span class="material-symbols-outlined text-[22px] text-primary mt-0.5">add_photo_alternate</span>
        <div class="min-w-0">
          <h1 class="font-headline-sm text-headline-sm text-on-surface font-bold leading-tight">Carga de img</h1>
          <p class="font-label-sm text-label-sm text-on-surface-variant"><b>Subir</b> · <b>IA</b> · <b>Google</b> busca fotos masivas con Apify</p>
        </div>
      </div>
      <div class="bg-surface-container rounded-xl p-2.5 shadow-sm flex flex-col gap-2">
        <div class="flex items-center gap-1.5 bg-surface-container-lowest rounded-lg p-1">
          <span class="material-symbols-outlined text-[20px] text-on-surface-variant ml-1">search</span>
          <input id="imagenesSearch" class="flex-1 bg-transparent font-body-md text-body-md text-on-surface px-1 h-9 focus:outline-none min-w-0" placeholder="Buscar código o descripción..." type="search" value="${escapeHtml(state.imagenes.q)}" />
        </div>
        <button type="button" id="imagenesGoogleBtn" class="h-10 w-full rounded-lg bg-surface-container-high text-on-surface border border-outline-variant font-label-md text-label-md font-bold inline-flex items-center justify-center gap-1.5">
          <span class="material-symbols-outlined text-[18px]">travel_explore</span>
          <span id="imagenesGoogleBtnLabel">Buscar Google (sin img)</span>
        </button>
        <p id="imagenesGoogleJob" class="hidden font-label-sm text-[11px] text-on-surface-variant px-0.5"></p>
        <p id="imagenesBflHint" class="font-label-sm text-[11px] text-on-surface-variant px-0.5">Comprobando Black Forest Labs…</p>
        <div class="grid grid-cols-3 gap-1.5 text-center">
          <div class="rounded-lg bg-surface-container-lowest px-1.5 py-1.5">
            <p class="font-label-sm text-[10px] text-on-surface-variant uppercase font-bold">Códigos</p>
            <p id="imgTotalCodigos" class="font-code-md text-code-md font-black tabular-nums">${state.imagenes.totales.codigos || 0}</p>
          </div>
          <div class="rounded-lg bg-surface-container-lowest px-1.5 py-1.5">
            <p class="font-label-sm text-[10px] text-on-surface-variant uppercase font-bold">Con img</p>
            <p id="imgTotalCon" class="font-code-md text-code-md font-black tabular-nums text-primary">${state.imagenes.totales.conImagen || 0}</p>
          </div>
          <div class="rounded-lg bg-surface-container-lowest px-1.5 py-1.5">
            <p class="font-label-sm text-[10px] text-on-surface-variant uppercase font-bold">Sin img</p>
            <p id="imgTotalSin" class="font-code-md text-code-md font-black tabular-nums">${state.imagenes.totales.sinImagen || 0}</p>
          </div>
        </div>
      </div>
    </div>
    <div id="imagenesList" class="flex-1 min-h-0 overflow-y-auto"></div>
    ${toastHtml()}
  </main>
  <div id="enhancePreviewModal" class="hidden fixed inset-0 z-[85] items-end sm:items-center justify-center bg-on-surface/40 backdrop-blur-[2px] p-gutter">
    <div class="w-full max-w-lg max-h-[90vh] bg-surface-container-lowest rounded-xl shadow-xl flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="enhancePreviewTitle">
      <div class="shrink-0 px-space-md pt-space-md pb-2 flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <h2 id="enhancePreviewTitle" class="font-headline-sm text-headline-sm text-on-surface font-bold leading-tight">¿Usar la mejora IA?</h2>
          <p id="enhancePreviewMethod" class="font-label-sm text-[11px] text-on-surface-variant mt-0.5"></p>
        </div>
        <button type="button" id="enhancePreviewCloseBtn" class="w-8 h-8 rounded-full text-on-surface-variant hover:bg-surface-container flex items-center justify-center shrink-0" aria-label="Cerrar">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <div class="px-space-md pb-space-md overflow-y-auto flex flex-col gap-3">
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1">
            <p class="font-label-sm text-[10px] uppercase font-bold text-on-surface-variant text-center">Original</p>
            <div class="aspect-square rounded-lg overflow-hidden bg-surface-container border border-outline-variant">
              <img id="enhancePreviewOriginal" alt="Original" class="w-full h-full object-contain bg-white" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <p class="font-label-sm text-[10px] uppercase font-bold text-primary text-center">IA</p>
            <div class="aspect-square rounded-lg overflow-hidden bg-surface-container border border-primary/40">
              <img id="enhancePreviewAi" alt="Mejorada con IA" class="w-full h-full object-contain bg-white" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" id="enhancePreviewDiscardBtn" class="h-11 rounded-lg bg-surface-container-high text-on-surface border border-outline-variant font-label-md text-label-md font-bold inline-flex items-center justify-center gap-1">
            Mantener original
          </button>
          <button type="button" id="enhancePreviewAcceptBtn" class="h-11 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-bold inline-flex items-center justify-center gap-1">
            Usar IA
          </button>
        </div>
      </div>
    </div>
  </div>
  ${navHtml()}
  `;

  let timer = null;
  document.getElementById('imagenesSearch')?.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.imagenes.q = String(e.target.value || '').trim();
      loadImagenesProductos();
    }, 250);
  });

  document.getElementById('enhancePreviewAcceptBtn')?.addEventListener('click', () => {
    acceptEnhancePreview();
  });
  document.getElementById('enhancePreviewDiscardBtn')?.addEventListener('click', async () => {
    await closeEnhancePreviewModal({ discard: true });
    showToast('Se mantuvo la original');
  });
  document.getElementById('enhancePreviewCloseBtn')?.addEventListener('click', async () => {
    await closeEnhancePreviewModal({ discard: true });
    showToast('Se mantuvo la original');
  });
  document.getElementById('enhancePreviewModal')?.addEventListener('click', async (e) => {
    if (e.target.id === 'enhancePreviewModal') {
      await closeEnhancePreviewModal({ discard: true });
      showToast('Se mantuvo la original');
    }
  });

  document.getElementById('imagenesGoogleBtn')?.addEventListener('click', () => {
    startBusquedaGoogleMasiva();
  });

  api.productoImagenes
    .status()
    .then((s) => {
      state.imagenes.bflConfigured = Boolean(s?.bflConfigured);
      state.imagenes.apifyConfigured = Boolean(s?.apifyConfigured);
      const hint = document.getElementById('imagenesBflHint');
      if (hint) {
        const bfl = state.imagenes.bflConfigured
          ? 'BFL listo'
          : 'Falta BFL_API_KEY';
        const apify = state.imagenes.apifyConfigured
          ? 'Apify listo (Google masivo)'
          : 'Falta APIFY_TOKEN (Google)';
        hint.textContent = `${bfl} · ${apify}`;
        hint.classList.toggle(
          'text-error',
          !state.imagenes.bflConfigured || !state.imagenes.apifyConfigured
        );
      }
      const gBtn = document.getElementById('imagenesGoogleBtn');
      if (gBtn && !state.imagenes.apifyConfigured) {
        gBtn.disabled = true;
        gBtn.classList.add('opacity-60');
      }
    })
    .catch(() => {
      const hint = document.getElementById('imagenesBflHint');
      if (hint) {
        hint.textContent = 'No se pudo verificar BFL / Apify';
        hint.classList.add('text-error');
      }
    });

  loadImagenesProductos().then(() => {
    if (state.imagenes.enhancePreview?.previewUrl) {
      openEnhancePreviewModal(state.imagenes.enhancePreview);
      return;
    }
    const pending = state.imagenes.items.find((i) => i.tienePreview && i.previewUrl);
    if (pending) {
      openEnhancePreviewModal({
        codigo: pending.codigo,
        originalUrl: pending.imagenUrl,
        previewUrl: pending.previewUrl,
        enhanceMethod: null,
      });
    }
  });
}

async function renderApp() {
  const next = currentHashView();
  const leavingTriage = state.view === 'triage' && next !== 'triage';
  state.view = next;

  if (leavingTriage) await stopScanner();
  document.removeEventListener('click', onDocumentClickCloseMenus);
  document.body.classList.remove('inv-lock-scroll');

  if (state.view === 'inventario') {
    renderInventarioView();
  } else if (state.view === 'imagenes') {
    renderImagenesView();
  } else {
    renderTriageView();
  }
}

async function init() {
  try {
    await loadCatalogos();
  } catch (err) {
    console.error(err);
  }
  await renderApp();
  window.addEventListener('hashchange', () => {
    renderApp();
  });
}

window.addEventListener('beforeunload', () => {
  stopScanner();
});

init();
