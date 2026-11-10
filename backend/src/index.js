import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { getDbPath, pingDb } from './db/database.js';
import { isCedisConfigured, pingCedis } from './db/cedis.js';
import productosRouter from './routes/productos.js';
import sucursalesRouter from './routes/sucursales.js';
import estatusRouter from './routes/estatus.js';
import devolucionesRouter from './routes/devoluciones.js';
import sesionesRouter from './routes/sesiones.js';
import productoImagenesRouter from './routes/productoImagenes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const webDistDir = path.resolve(__dirname, '../web/dist');

app.use(cors());
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  const dbOk = pingDb();
  const cedis = await pingCedis();
  res.json({
    ok: dbOk,
    message: dbOk ? 'Backend y SQLite activos' : 'Backend activo, SQLite con error',
    database: getDbPath(),
    cedis: {
      configured: isCedisConfigured(),
      ok: cedis.ok,
      server: cedis.server || process.env.MSSQL_SERVER,
      database: cedis.database || process.env.MSSQL_DATABASE,
      error: cedis.error || null,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (_req, res) => {
  res.json({
    name: 'app-escaneo-maquinas-inventario',
    version: '1.2.0',
    database: 'sqlite+cedis',
  });
});

app.use('/api/productos', productosRouter);
app.use('/api/sucursales', sucursalesRouter);
app.use('/api/estatus', estatusRouter);
app.use('/api/devoluciones', devolucionesRouter);
app.use('/api/sesiones', sesionesRouter);
app.use('/api/producto-imagenes', productoImagenesRouter);

if (fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDistDir, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Servidor Express en http://${HOST}:${PORT}`);
  console.log(`SQLite en ${getDbPath()}`);
  if (fs.existsSync(webDistDir)) {
    console.log(`Frontend estático en ${webDistDir}`);
  }
  console.log(
    `CEDIS ${isCedisConfigured() ? `${process.env.MSSQL_SERVER}/${process.env.MSSQL_DATABASE}` : 'no configurado'}`
  );
});
