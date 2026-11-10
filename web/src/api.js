async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Error HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  productos: {
    list: () => request('/api/productos'),
    buscar: (codigo) => request(`/api/productos/buscar/${encodeURIComponent(codigo)}`),
  },
  sucursales: {
    list: () => request('/api/sucursales'),
  },
  estatus: {
    list: () => request('/api/estatus'),
    create: (payload) =>
      request('/api/estatus', { method: 'POST', body: JSON.stringify(payload) }),
  },
  devoluciones: {
    hoy: () => request('/api/devoluciones?hoy=1'),
    countHoy: () => request('/api/devoluciones/hoy/count'),
    create: (payload) =>
      request('/api/devoluciones', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id, payload) =>
      request(`/api/devoluciones/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    remove: (id) =>
      request(`/api/devoluciones/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    inventario: ({ q = '', sucursalId = '', estatusId = '' } = {}) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (sucursalId) params.set('sucursal_id', String(sucursalId));
      if (estatusId) params.set('estatus_id', String(estatusId));
      const qs = params.toString();
      return request(`/api/devoluciones/inventario${qs ? `?${qs}` : ''}`);
    },
    inventarioExcelUrl: ({ q = '', sucursalId = '', estatusId = '' } = {}) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (sucursalId) params.set('sucursal_id', String(sucursalId));
      if (estatusId) params.set('estatus_id', String(estatusId));
      const qs = params.toString();
      return `/api/devoluciones/inventario/excel${qs ? `?${qs}` : ''}`;
    },
  },
  productoImagenes: {
    status: () => request('/api/producto-imagenes/status'),
    list: ({ q = '' } = {}) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const qs = params.toString();
      return request(`/api/producto-imagenes${qs ? `?${qs}` : ''}`);
    },
    upload: async (codigo, file) => {
      const body = new FormData();
      body.append('imagen', file);
      const res = await fetch(
        `/api/producto-imagenes/${encodeURIComponent(codigo)}`,
        { method: 'POST', body }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(data.error || `Error HTTP ${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
      }
      return data;
    },
    enhance: (codigo) =>
      request(`/api/producto-imagenes/${encodeURIComponent(codigo)}/enhance`, {
        method: 'POST',
      }),
    acceptEnhance: (codigo) =>
      request(`/api/producto-imagenes/${encodeURIComponent(codigo)}/enhance/accept`, {
        method: 'POST',
      }),
    discardEnhance: (codigo) =>
      request(`/api/producto-imagenes/${encodeURIComponent(codigo)}/enhance/discard`, {
        method: 'POST',
      }),
    buscarGoogle: (payload = {}) =>
      request('/api/producto-imagenes/buscar-google', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    buscarGoogleJob: () => request('/api/producto-imagenes/buscar-google/job'),
    remove: (codigo) =>
      request(`/api/producto-imagenes/${encodeURIComponent(codigo)}`, {
        method: 'DELETE',
      }),
  },
};
