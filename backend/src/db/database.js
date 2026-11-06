import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
const dbPath = path.join(dataDir, 'inventario.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

const productoCols = tableColumns('productos');
const needsCedisMigration =
  productoCols.length > 0 && !productoCols.includes('codigo_barra');

if (needsCedisMigration) {
  db.exec(`
    DROP TABLE IF EXISTS devoluciones;
    DROP TABLE IF EXISTS productos;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    articulo TEXT NOT NULL,
    codigo_barra TEXT NOT NULL UNIQUE,
    itemdesc TEXT NOT NULL,
    cantidad REAL NOT NULL DEFAULT 1,
    udm TEXT NOT NULL DEFAULT 'UND',
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sucursales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    bahia TEXT,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS estatus_devolucion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    icono TEXT,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sesiones_escaneo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    iniciada_en TEXT NOT NULL DEFAULT (datetime('now')),
    terminada_en TEXT,
    activa INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS devoluciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    codigo_escaneado TEXT NOT NULL,
    articulo TEXT,
    codigo_barra TEXT,
    itemdesc TEXT,
    cantidad REAL,
    udm TEXT,
    sucursal_id INTEGER NOT NULL,
    estatus_id INTEGER NOT NULL,
    sesion_id INTEGER,
    orden INTEGER,
    notas TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL,
    FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
    FOREIGN KEY (estatus_id) REFERENCES estatus_devolucion(id),
    FOREIGN KEY (sesion_id) REFERENCES sesiones_escaneo(id)
  );

  CREATE INDEX IF NOT EXISTS idx_productos_codigo_barra ON productos(codigo_barra);
  CREATE INDEX IF NOT EXISTS idx_productos_articulo ON productos(articulo);
  CREATE INDEX IF NOT EXISTS idx_devoluciones_fecha ON devoluciones(creado_en);
`);

// Migración suave si la DB ya existía sin orden/sesión
const devolucionCols = tableColumns('devoluciones');
if (!devolucionCols.includes('orden')) {
  db.exec('ALTER TABLE devoluciones ADD COLUMN orden INTEGER');
}
if (!devolucionCols.includes('sesion_id')) {
  db.exec('ALTER TABLE devoluciones ADD COLUMN sesion_id INTEGER');
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_devoluciones_sesion_orden
  ON devoluciones(sesion_id, orden)
`);

function ensureTiendasT01T49() {
  // Desactivar tiendas viejas que no sean T01-T49
  db.prepare(
    `UPDATE sucursales
     SET activo = 0
     WHERE codigo NOT GLOB 'T[0-9][0-9]'`
  ).run();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO sucursales (codigo, nombre, bahia, activo)
     VALUES (?, ?, ?, 1)`
  );
  const activate = db.prepare(
    `UPDATE sucursales
     SET nombre = ?, bahia = ?, activo = 1
     WHERE codigo = ?`
  );

  for (let i = 1; i <= 49; i += 1) {
    const codigo = `T${String(i).padStart(2, '0')}`;
    const nombre = `Tienda ${codigo}`;
    insert.run(codigo, nombre, codigo);
    activate.run(nombre, codigo, codigo);
  }
}

function ensureEstatusBase() {
  const danada = db
    .prepare(`SELECT id FROM estatus_devolucion WHERE codigo = 'danada'`)
    .get();

  if (!danada) {
    db.prepare(
      `INSERT INTO estatus_devolucion (codigo, nombre, icono, activo)
       VALUES ('danada', 'Devolución Dañada', 'report', 1)`
    ).run();
  } else {
    db.prepare(
      `UPDATE estatus_devolucion
       SET activo = 1,
           nombre = 'Devolución Dañada',
           icono = 'report'
       WHERE codigo = 'danada'`
    ).run();
  }

  // Apagar solo los estatus demo viejos (no los creados por el usuario)
  db.prepare(
    `UPDATE estatus_devolucion
     SET activo = 0
     WHERE codigo IN ('regular', 'empaque', 'fabrica', 'revision', 'prueba_modal_runtime')`
  ).run();
}

function seedProductosIfEmpty() {
  const countProductos = db.prepare('SELECT COUNT(*) AS c FROM productos').get().c;
  if (countProductos > 0) return;

  const insert = db.prepare(
    `INSERT INTO productos (articulo, codigo_barra, itemdesc, cantidad, udm)
     VALUES (?, ?, ?, ?, ?)`
  );
  insert.run(
    '714680003',
    '037431884374',
    'MAQ COSER SINGER DOM 1412',
    1,
    'UND'
  );
  insert.run('714680010', '037431884375', 'MAQ COSER SINGER DOM 2250', 1, 'UND');
  insert.run('714680020', '037431884376', 'PLANCHA VAPOR BLACK DECKER', 1, 'UND');
}

ensureTiendasT01T49();
ensureEstatusBase();
seedProductosIfEmpty();

/** Normaliza fila DB → shape CEDIS */
export function toCedisProducto(row) {
  if (!row) return null;
  return {
    id: row.id,
    Articulo: String(row.articulo ?? '').trim(),
    CodigoBarra: String(row.codigo_barra ?? '').trim(),
    ITEMDESC: String(row.itemdesc ?? '').trim(),
    Cantidad: Number(row.cantidad ?? 1),
    UdM: String(row.udm ?? 'UND').trim(),
  };
}

export function getDb() {
  return db;
}

export function getDbPath() {
  return dbPath;
}

export function pingDb() {
  const row = db.prepare('SELECT 1 AS ok').get();
  return row?.ok === 1;
}
