import './style.css';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from './api.js';

const state = {
  view: 'triage',
  flashOn: false,
  muted: false,
  scanning: false,
  producto: null,
  sucursales: [],
  estatus: [],
  historialHoy: [],
  selectedEstatusId: null,
  selectedTiendaId: null,
  openMenu: null, // 'status' | 'tienda' | 'invTienda' | null
  scanner: null,
  lastScanAt: 0,
  inventario: {
    items: [],
    totales: { registros: 0, cantidad: 0 },
    q: '',
    sucursalId: '',
    loading: false,
  },
  sesion: {
    activa: false,
    sesionId: null,
    siguiente_orden: 1,
    total: 0,
    ultimo_orden: 0,
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
  const normalized = isoLike.includes('T') ? isoLike : `${isoLike.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return isoLike.slice(11, 16) || '--:--';
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
  return 'triage';
}

function navHtml() {
  const triageActive = state.view === 'triage';
  const invActive = state.view === 'inventario';
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
      <a class="relative flex flex-col items-center justify-center min-w-[72px] h-12 gap-0.5 ${idle} transition-colors" href="#triage">
        <div class="relative">
          <span class="material-symbols-outlined text-[22px]">inventory_2</span>
          <span id="navHistorialCount" class="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-surface-container-high text-on-surface font-code-sm text-[10px] flex items-center justify-center font-semibold">${state.historialHoy.length}</span>
        </div>
        <span class="font-label-sm text-label-sm">Historial</span>
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

/* ---------------- Triage helpers ---------------- */

function renderHistorial() {
  const list = document.getElementById('historialList');
  const countBadge = document.getElementById('historialCount');
  const navBadge = document.getElementById('navHistorialCount');
  if (!list) return;

  const total = state.historialHoy.length;
  if (countBadge) countBadge.textContent = `${total} ítems`;
  if (navBadge) navBadge.textContent = String(total);

  if (total === 0) {
    list.innerHTML = `
      <div class="p-3 rounded-lg bg-surface-container-low text-on-surface-variant font-body-sm text-body-sm text-center">
        Aún no hay devoluciones registradas hoy.
      </div>`;
    return;
  }

  list.innerHTML = state.historialHoy
    .map(
      (item) => `
      <div class="flex items-center justify-between p-2 rounded-lg bg-surface-container-low gap-2" data-devolucion-id="${escapeHtml(item.id)}">
        <div class="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-code-sm text-code-sm font-bold shrink-0">
          ${escapeHtml(item.orden ?? '—')}
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <span class="font-label-md text-label-md text-on-surface font-semibold truncate">
            ${escapeHtml(item.ITEMDESC || item.codigo_escaneado)}
          </span>
          <span class="font-code-sm text-code-sm text-on-surface-variant">
            ${escapeHtml(
              [item.Articulo, item.CodigoBarra].filter(Boolean).join(' · ') ||
                item.codigo_escaneado
            )}
          </span>
          <span class="font-code-sm text-code-sm text-secondary">
            ${escapeHtml(`${item.Cantidad ?? 1} ${item.UdM || 'UND'} · ${item.sucursal_codigo || item.sucursal_nombre || ''}`)}
          </span>
        </div>
        <div class="flex flex-col items-end shrink-0 ml-1 gap-1">
          <span class="font-code-sm text-code-sm text-secondary font-medium">${escapeHtml(formatTime(item.creado_en))}</span>
          <span class="text-[10px] text-error font-semibold uppercase tracking-wide">
            ${escapeHtml(item.estatus_nombre || 'Sin estatus')}
          </span>
          <button type="button" class="deleteDevolucionBtn h-8 w-8 rounded-lg text-error hover:bg-error-container/30 flex items-center justify-center" data-id="${escapeHtml(item.id)}" data-orden="${escapeHtml(item.orden ?? item.id)}" aria-label="Eliminar #${escapeHtml(item.orden ?? item.id)}">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>`
    )
    .join('');

  list.querySelectorAll('.deleteDevolucionBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      eliminarDevolucion(btn.dataset.id, btn.dataset.orden);
    });
  });
}

async function eliminarDevolucion(id, orden) {
  const label = orden ? `#${orden}` : `id ${id}`;
  if (!window.confirm(`¿Eliminar el registro ${label}?`)) return;

  try {
    const result = await api.devoluciones.remove(id);
    showToast(result.mensaje || `Eliminado ${label}`);
    state.historialHoy = await api.devoluciones.hoy();
    renderHistorial();
    await loadSesion();
    if (state.view === 'inventario') {
      await loadInventario();
    }
  } catch (err) {
    showToast(err.message || 'No se pudo eliminar.');
  }
}

function renderSesionBadge() {
  const orden = state.sesion.siguiente_orden || 1;
  const total = state.sesion.total || 0;
  const metaText =
    total > 0
      ? `${total} registrados · próximo #${orden}`
      : `Próximo registro #${orden}`;
  const badge = document.getElementById('sesionOrdenBadgeTop');
  const meta = document.getElementById('sesionMetaTop');
  const saveLabel = document.getElementById('saveOrdenLabel');
  if (badge) badge.textContent = `#${orden}`;
  if (meta) meta.textContent = metaText;
  if (saveLabel) saveLabel.textContent = `Registrar #${orden}`;
}

async function loadSesion() {
  try {
    const data = await api.sesiones.activa();
    state.sesion = {
      activa: Boolean(data.activa),
      sesionId: data.sesion?.id ?? null,
      siguiente_orden: data.siguiente_orden || 1,
      total: data.total || 0,
      ultimo_orden: data.ultimo_orden || 0,
    };
  } catch {
    state.sesion = {
      activa: false,
      sesionId: null,
      siguiente_orden: 1,
      total: 0,
      ultimo_orden: 0,
    };
  }
  renderSesionBadge();
}

function renderProductoCard() {
  const card = document.getElementById('productoCard');
  const empty = document.getElementById('productoEmpty');
  if (!card || !empty) return;

  if (!state.producto) {
    card.classList.add('hidden');
    card.classList.remove('flex');
    empty.classList.remove('hidden');
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

function pickerHtml({ key, icon = 'list', placeholder = 'Seleccionar' }) {
  return `
    <div class="relative w-full" data-picker="${key}">
      <input type="hidden" id="${key}Select" value="" />
      <button
        type="button"
        id="${key}Trigger"
        class="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-outline-variant flex items-center gap-2 text-left focus:outline-none focus:border-primary hover:bg-surface-container transition-colors"
        aria-haspopup="listbox"
        aria-expanded="false"
      >
        <span id="${key}TriggerIcon" class="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">${escapeHtml(icon)}</span>
        <span id="${key}TriggerLabel" class="flex-1 min-w-0 font-label-md text-label-md font-semibold text-on-surface truncate">${escapeHtml(placeholder)}</span>
        <span id="${key}TriggerChevron" class="material-symbols-outlined text-[20px] text-on-surface-variant shrink-0">expand_more</span>
      </button>
      <div
        id="${key}Menu"
        class="hidden absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-56 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest shadow-lg py-1"
        role="listbox"
      ></div>
    </div>`;
}

function closeAllMenus() {
  ['status', 'tienda', 'invTienda'].forEach((key) => {
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
  if (!state.selectedEstatusId && state.estatus[0]) {
    state.selectedEstatusId = Number(state.estatus[0].id);
  }
  if (
    state.selectedEstatusId &&
    !state.estatus.some((e) => Number(e.id) === Number(state.selectedEstatusId))
  ) {
    state.selectedEstatusId = state.estatus[0] ? Number(state.estatus[0].id) : null;
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

function tiendaOptions({ includeAll = false } = {}) {
  const options = [];
  if (includeAll) {
    options.push({ value: '', label: 'Todas las tiendas', icon: 'storefront' });
  }
  for (const s of state.sucursales) {
    options.push({
      value: String(s.id),
      label: `${s.codigo} — ${s.nombre}`,
      icon: 'store',
    });
  }
  return options;
}

function selectTienda(id) {
  state.selectedTiendaId = id == null || id === '' ? null : Number(id);
  renderTiendaSelect();
  updateBahiaHint();
}

function renderTiendaSelect() {
  // Sin tienda por defecto: el usuario debe elegirla.
  if (
    state.selectedTiendaId &&
    !state.sucursales.some((s) => Number(s.id) === Number(state.selectedTiendaId))
  ) {
    state.selectedTiendaId = null;
  }

  renderPickerMenu({
    key: 'tienda',
    options: tiendaOptions({ includeAll: false }),
    value: state.selectedTiendaId ? String(state.selectedTiendaId) : '',
    placeholder: 'Seleccionar tienda',
    defaultIcon: 'store',
    onSelect: (v) => selectTienda(v),
  });
}

function renderInvTiendaSelect() {
  renderPickerMenu({
    key: 'invTienda',
    options: tiendaOptions({ includeAll: true }),
    value: state.inventario.sucursalId || '',
    placeholder: 'Todas las tiendas',
    defaultIcon: 'storefront',
    onSelect: (v) => {
      state.inventario.sucursalId = v || '';
      renderInvTiendaSelect();
      loadInventario();
    },
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

async function buscarProducto(codigo) {
  const clean = String(codigo || '').trim();
  if (!clean) {
    showToast('Ingresa o escanea un código.');
    return;
  }
  const input = document.getElementById('barcodeInput');
  if (input) input.value = clean;

  try {
    const producto = await api.productos.buscar(clean);
    state.producto = producto;
    playBeep();
    renderProductoCard();
    showToast(`Producto encontrado: ${producto.ITEMDESC}`);
  } catch (err) {
    state.producto = null;
    renderProductoCard();
    showToast(err.status === 404 ? `No encontrado: ${clean}` : err.message);
  }
}

async function guardarDevolucion() {
  const codigo = document.getElementById('barcodeInput')?.value?.trim();
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
    });

    showToast(
      result.orden
        ? `Registrado #${result.orden}`
        : result.mensaje || 'Devolución registrada.'
    );
    state.historialHoy = await api.devoluciones.hoy();
    await loadSesion();
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
  const input = document.getElementById('barcodeInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  renderProductoCard();
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
  const regionId = 'scannerRegion';
  const region = document.getElementById(regionId);
  if (!region || state.scanning) return;

  try {
    state.scanner = new Html5Qrcode(regionId);
    await state.scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 120 }, aspectRatio: 1.777 },
      (decodedText) => {
        const now = Date.now();
        if (now - state.lastScanAt < 1800) return;
        state.lastScanAt = now;
        buscarProducto(decodedText);
      },
      () => {}
    );
    state.scanning = true;
    const hint = document.getElementById('scannerHint');
    if (hint) hint.textContent = 'Cámara activa · apunta al código';
  } catch {
    const hint = document.getElementById('scannerHint');
    if (hint) hint.textContent = 'Cámara no disponible · usa ingreso manual';
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

async function loadInventario() {
  state.inventario.loading = true;
  renderInventarioList();
  try {
    const data = await api.devoluciones.inventario({
      q: state.inventario.q,
      sucursalId: state.inventario.sucursalId,
    });
    state.inventario.items = data.items || [];
    state.inventario.totales = data.totales || { registros: 0, cantidad: 0 };
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
  const totalReg = document.getElementById('totalRegistros');
  const totalCant = document.getElementById('totalCantidad');
  if (totalReg) totalReg.textContent = String(state.inventario.totales.registros || 0);
  if (totalCant) totalCant.textContent = String(state.inventario.totales.cantidad || 0);
  if (!list) return;

  if (state.inventario.loading) {
    list.innerHTML = `<div class="p-4 text-center text-on-surface-variant font-body-sm text-body-sm">Cargando inventarios...</div>`;
    return;
  }

  if (!state.inventario.items.length) {
    list.innerHTML = `<div class="p-4 text-center text-on-surface-variant font-body-sm text-body-sm">No hay escaneos con esos filtros.</div>`;
    return;
  }

  list.innerHTML = state.inventario.items
    .map(
      (item) => `
    <article class="bg-surface-container-lowest rounded-xl p-3 shadow-sm border border-surface-container-low flex flex-col gap-2" data-devolucion-id="${escapeHtml(item.id)}">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2 min-w-0 flex-1">
          <div class="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-code-md text-code-md font-bold shrink-0">
            ${escapeHtml(item.orden ?? '—')}
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="font-headline-sm text-headline-sm text-on-surface truncate">${escapeHtml(item.ITEMDESC || 'Sin descripción')}</h3>
            <p class="font-code-sm text-code-sm text-on-surface-variant mt-0.5">
              Art. ${escapeHtml(item.Articulo || '—')} · ${escapeHtml(item.CodigoBarra || item.codigo_escaneado || '—')}
            </p>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">
          <span class="font-code-sm text-code-sm bg-primary-fixed text-on-primary-fixed px-2 py-0.5 rounded-full font-semibold">
            ${escapeHtml(item.sucursal_codigo || '—')}
          </span>
          <button type="button" class="deleteDevolucionBtn h-9 px-2 rounded-lg text-error hover:bg-error-container/30 flex items-center gap-1 font-label-sm text-label-sm" data-id="${escapeHtml(item.id)}" data-orden="${escapeHtml(item.orden ?? item.id)}" aria-label="Eliminar #${escapeHtml(item.orden ?? item.id)}">
            <span class="material-symbols-outlined text-[18px]">delete</span>
            Eliminar
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 text-on-surface-variant">
        <div class="rounded-lg bg-surface-container-low px-2.5 py-2">
          <div class="font-label-sm text-label-sm">Cantidad</div>
          <div class="font-code-md text-code-md text-on-surface font-semibold">${escapeHtml(`${item.Cantidad ?? 1} ${item.UdM || 'UND'}`)}</div>
        </div>
        <div class="rounded-lg bg-surface-container-low px-2.5 py-2">
          <div class="font-label-sm text-label-sm">Estatus</div>
          <div class="font-label-md text-label-md text-on-surface font-semibold truncate">${escapeHtml(item.estatus_nombre || '—')}</div>
        </div>
        <div class="rounded-lg bg-surface-container-low px-2.5 py-2">
          <div class="font-label-sm text-label-sm">Tienda</div>
          <div class="font-label-md text-label-md text-on-surface font-semibold truncate">${escapeHtml(item.sucursal_nombre || item.sucursal_codigo || '—')}</div>
        </div>
        <div class="rounded-lg bg-surface-container-low px-2.5 py-2">
          <div class="font-label-sm text-label-sm">Fecha</div>
          <div class="font-code-sm text-code-sm text-on-surface font-semibold">${escapeHtml(formatDateTime(item.creado_en))}</div>
        </div>
      </div>
    </article>`
    )
    .join('');

  list.querySelectorAll('.deleteDevolucionBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      eliminarDevolucion(btn.dataset.id, btn.dataset.orden);
    });
  });
}

function renderInventarioView() {
  app.innerHTML = `
  <main class="flex-1 flex flex-col relative w-full pb-24 bg-surface pt-4 pt-safe">
    <div class="px-gutter pb-space-sm flex flex-col gap-space-sm">
      <div>
        <h1 class="font-headline-md text-headline-md text-on-surface">Inventario</h1>
        <p class="font-body-sm text-body-sm text-on-surface-variant">Escaneos registrados con todos sus campos</p>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-xl bg-primary-fixed text-on-primary-fixed p-3">
          <div class="font-label-sm text-label-sm opacity-80">Total registros</div>
          <div id="totalRegistros" class="font-display-lg text-display-lg">${state.inventario.totales.registros || 0}</div>
        </div>
        <div class="rounded-xl bg-secondary-container text-on-secondary-container p-3">
          <div class="font-label-sm text-label-sm opacity-80">Total cantidad</div>
          <div id="totalCantidad" class="font-display-lg text-display-lg">${state.inventario.totales.cantidad || 0}</div>
        </div>
      </div>

      <div class="bg-surface-container rounded-xl p-2.5 flex flex-col gap-2 shadow-sm">
        <div class="flex items-center gap-1.5 bg-surface-container-lowest rounded-lg p-1">
          <span class="material-symbols-outlined text-[20px] text-on-surface-variant ml-1">search</span>
          <input id="inventarioSearch" class="flex-1 bg-transparent font-body-md text-body-md text-on-surface px-1 h-9 focus:outline-none min-w-0" placeholder="Buscar artículo, barra, descripción..." type="search" value="${escapeHtml(state.inventario.q)}" />
        </div>
        ${pickerHtml({ key: 'invTienda', icon: 'storefront', placeholder: 'Todas las tiendas' })}
      </div>

      <div id="inventarioList" class="flex flex-col gap-2"></div>
    </div>
    ${toastHtml()}
  </main>
  ${navHtml()}
  `;

  renderInvTiendaSelect();
  bindInventarioEvents();
  loadInventario();
}

function bindInventarioEvents() {
  const search = document.getElementById('inventarioSearch');
  let timer = null;

  search?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.inventario.q = search.value.trim();
      loadInventario();
    }, 250);
  });

  document.getElementById('invTiendaTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu('invTienda');
  });
  document.addEventListener('click', onDocumentClickCloseMenus);
}

/* ---------------- Triage view ---------------- */

function renderTriageView() {
  app.innerHTML = `
  <main class="flex-1 flex flex-col relative w-full pb-24 bg-surface pt-4 pt-safe">
    <div class="flex flex-col w-full">
      <div class="px-gutter pb-space-sm">
        <div class="bg-primary text-on-primary rounded-xl px-3 py-2.5 shadow-md flex items-center justify-between gap-2 mb-2">
          <div class="min-w-0">
            <p class="font-label-sm text-label-sm opacity-90">Orden compartido</p>
            <p id="sesionMetaTop" class="font-body-sm text-body-sm opacity-80 truncate">Próximo registro #1</p>
          </div>
          <span id="sesionOrdenBadgeTop" class="bg-on-primary text-primary font-code-md text-code-md min-w-12 h-12 px-2 rounded-xl flex items-center justify-center font-black text-2xl leading-none shrink-0">#1</span>
        </div>
        <div class="relative w-full h-40 rounded-xl bg-inverse-surface overflow-hidden shadow-md flex flex-col justify-between p-3">
          <div id="scannerRegion"></div>
          <div class="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:14px_14px] z-[2]"></div>
          <div class="absolute inset-x-8 top-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-[3]">
            <div class="w-full h-0.5 bg-primary-container shadow-[0_0_12px_#0d5bff] animate-pulse"></div>
          </div>
          <div class="relative z-10 flex items-center justify-between">
            <span class="bg-inverse-surface/80 text-inverse-on-surface font-code-sm text-code-sm px-2 py-0.5 rounded-DEFAULT backdrop-blur-md">Enfoque automático</span>
            <div class="flex items-center gap-1.5">
              <button class="w-8 h-8 rounded-full bg-surface-container-highest/30 text-inverse-on-surface flex items-center justify-center" id="flashToggle" type="button">
                <span class="material-symbols-outlined text-[18px]">flash_on</span>
              </button>
              <button class="w-8 h-8 rounded-full bg-surface-container-highest/30 text-inverse-on-surface flex items-center justify-center" id="beepToggle" type="button">
                <span class="material-symbols-outlined text-[18px]">volume_up</span>
              </button>
            </div>
          </div>
          <div class="relative z-10 flex items-center justify-center bg-inverse-surface/90 backdrop-blur-sm py-1.5 px-3 rounded-lg gap-2">
            <span class="material-symbols-outlined text-primary-fixed text-[16px]">qr_code_scanner</span>
            <span id="scannerHint" class="font-body-sm text-body-sm text-inverse-on-surface font-medium">Apunta al código de barras o QR</span>
          </div>
        </div>
      </div>

      <div class="px-gutter pb-space-sm">
        <div class="bg-surface-container p-2.5 rounded-xl flex flex-col gap-1.5 shadow-sm">
          <div class="flex items-center justify-between px-0.5">
            <label class="font-label-sm text-label-sm text-on-surface-variant font-semibold tracking-wide" for="barcodeInput">Ingreso manual de código</label>
            <span class="font-code-sm text-code-sm text-secondary">Código de barras</span>
          </div>
          <div class="flex items-center gap-1.5 bg-surface-container-lowest rounded-lg p-1">
            <button class="w-9 h-9 rounded-DEFAULT bg-surface-container text-on-surface flex items-center justify-center shrink-0" type="button" id="focusInputBtn">
              <span class="material-symbols-outlined text-[20px]">dialpad</span>
            </button>
            <input class="flex-1 bg-transparent font-code-md text-code-md text-on-surface px-1 focus:outline-none min-w-0 font-semibold" id="barcodeInput" placeholder="Ingresar código..." type="text" value="" autocomplete="off" />
            <button class="w-7 h-7 rounded-full text-secondary hover:text-on-surface flex items-center justify-center shrink-0" id="clearInputBtn" type="button">
              <span class="material-symbols-outlined text-[18px]">cancel</span>
            </button>
            <button id="buscarBtn" class="bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md px-3 h-9 rounded-lg flex items-center gap-1 shrink-0" type="button">
              <span>Buscar</span>
              <span class="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>

      <div class="px-gutter pb-space-sm">
        <div id="productoEmpty" class="bg-surface-container-lowest rounded-xl p-space-sm shadow-sm text-center text-on-surface-variant font-body-sm text-body-sm">
          Escanea o busca un código para identificar el producto.
        </div>

        <div id="productoCard" class="hidden bg-surface-container-lowest rounded-xl p-space-sm shadow-sm flex-col gap-3">
          <div class="flex items-center justify-between pb-1 border-b-2 border-surface-container-low">
            <div class="flex items-center gap-1.5 bg-surface-container-high px-2 py-0.5 rounded-DEFAULT">
              <span class="w-2 h-2 rounded-full bg-primary-container"></span>
              <span class="font-label-sm text-label-sm text-primary font-bold">Producto identificado</span>
            </div>
            <span class="font-code-sm text-code-sm text-secondary font-medium">CEDIS</span>
          </div>

          <div class="flex items-center gap-space-sm">
            <div class="w-16 h-16 rounded-lg bg-surface-container-high border border-outline-variant flex flex-col items-center justify-center shrink-0 text-primary shadow-sm">
              <span class="material-symbols-outlined text-[28px]">precision_manufacturing</span>
            </div>
            <div class="flex flex-col min-w-0 flex-1">
              <span id="productoNombre" class="font-headline-sm text-headline-sm text-on-surface truncate"></span>
              <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                <span class="font-code-sm text-code-sm text-on-surface-variant font-medium">Art. <span id="productoArticulo"></span></span>
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
              ${pickerHtml({ key: 'tienda', icon: 'store', placeholder: 'Seleccionar tienda' })}
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
            <span id="saveOrdenLabel">Registrar #1</span>
          </button>
          <button class="w-full h-9 rounded-lg bg-surface-container text-on-surface hover:bg-surface-container-high font-label-md text-label-md flex items-center justify-center gap-1.5" id="discardActionBtn" type="button">
            <span class="material-symbols-outlined text-[16px]">restart_alt</span>
            <span>Nuevo Escaneo</span>
          </button>
        </div>
      </div>

      <div class="px-gutter pb-space-sm flex flex-col gap-2">
        <div class="bg-surface-container-lowest rounded-xl p-space-sm shadow-sm flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-primary text-[18px]">history</span>
              <span class="font-headline-sm text-headline-sm text-on-surface">Devoluciones agregadas hoy</span>
            </div>
            <span id="historialCount" class="bg-primary-fixed text-on-primary-fixed font-code-sm text-code-sm px-2 py-0.5 rounded-full font-semibold">0 ítems</span>
          </div>
          <div id="historialList" class="flex flex-col gap-1.5 pt-1"></div>
        </div>
      </div>

      ${toastHtml()}
      ${estatusModalHtml()}
    </div>
  </main>
  ${navHtml()}
  `;

  bindTriageEvents();
  fillSelects();
  renderHistorial();
  renderProductoCard();
  loadSesion();
  startScanner();
}

function bindTriageEvents() {
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
    buscarProducto(document.getElementById('barcodeInput')?.value);
  });

  document.getElementById('barcodeInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarProducto(e.currentTarget.value);
    }
  });

  document.getElementById('tiendaTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu('tienda');
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

  document.getElementById('saveActionBtn')?.addEventListener('click', guardarDevolucion);
  document.getElementById('discardActionBtn')?.addEventListener('click', nuevoEscaneo);
}

function onDocumentClickCloseMenus(e) {
  if (!state.openMenu) return;
  const wrap = document.querySelector(`[data-picker="${state.openMenu}"]`);
  if (wrap && wrap.contains(e.target)) return;
  closeAllMenus();
}

/* ---------------- Router ---------------- */

async function renderApp() {
  const next = currentHashView();
  const leavingTriage = state.view === 'triage' && next !== 'triage';
  state.view = next;

  if (leavingTriage) await stopScanner();
  document.removeEventListener('click', onDocumentClickCloseMenus);

  if (state.view === 'inventario') {
    renderInventarioView();
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
