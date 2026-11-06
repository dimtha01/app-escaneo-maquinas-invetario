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
    remove: (id) =>
      request(`/api/devoluciones/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    inventario: ({ q = '', sucursalId = '' } = {}) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (sucursalId) params.set('sucursal_id', String(sucursalId));
      const qs = params.toString();
      return request(`/api/devoluciones/inventario${qs ? `?${qs}` : ''}`);
    },
  },
  sesiones: {
    activa: () => request('/api/sesiones/activa'),
  },
};
