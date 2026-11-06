# App Escaneo Máquinas / Inventario

Estructura base con frontend Vite (vanilla) y backend Express.

## Estructura

```
.
├── web/        # Frontend — Vite + Vanilla JS
└── backend/    # API — Express
```

## Requisitos

- Node.js 18+
- npm

## Instalación

```bash
npm run install:all
```

O por carpeta:

```bash
cd web && npm install
cd ../backend && npm install
```

## Desarrollo

En dos terminales:

```bash
# Terminal 1 — API en http://localhost:3000
npm run dev:backend

# Terminal 2 — Web en http://localhost:5173
npm run dev:web
```

El frontend usa proxy de Vite: las peticiones a `/api/*` van al backend en el puerto 3000.

## Base de datos

### Local (SQLite)

Archivo: `backend/data/inventario.db` — cache + devoluciones.

### CEDIS (SQL Server)

Configura `backend/.env` (ver `.env.example`):

| Variable | Valor desarrollo |
|----------|------------------|
| `MSSQL_SERVER` | `10.6.1.235` |
| `MSSQL_PORT` | `1433` |
| `MSSQL_DATABASE` | `CEDIS` |
| `MSSQL_USER` | (usuario) |
| `MSSQL_PASSWORD` | (password) |

La búsqueda (`GET /api/productos/buscar/:codigo`) consulta:

- `MTX_IVTrx_seriales_IPV` + `iv00101`
- por `Articulo` o `CodigoBarra`
- y guarda/actualiza el producto en SQLite

Ejemplo:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/productos/buscar/037431884374
```

## Endpoints

| Método | Ruta                         | Descripción                |
|--------|------------------------------|----------------------------|
| GET    | `/api/health`                | Health check + estado DB   |
| GET    | `/api/productos`             | Listar productos           |
| GET    | `/api/productos/buscar/:codigo` | Buscar por código/SKU/LPN |
| POST   | `/api/productos`             | Crear producto             |
| GET    | `/api/sucursales`            | Listar sucursales          |
| GET    | `/api/estatus`               | Listar estatus             |
| POST   | `/api/estatus`               | Crear estatus              |
| GET    | `/api/devoluciones?hoy=1`    | Historial (hoy opcional)   |
| POST   | `/api/devoluciones`          | Registrar devolución       |

## Flujo Triage (web)

1. Escanea con cámara o ingresa código manual (`7501030421893` de ejemplo)
2. Selecciona sucursal y estatus
3. Registra devolución → queda en historial del día
