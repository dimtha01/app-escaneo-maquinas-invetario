import Database from 'better-sqlite3';

const db = new Database('data/inventario.db');
db.pragma('journal_mode = WAL');

const antes = db
  .prepare(
    `SELECT COUNT(*) AS c, MIN(orden) AS min_o, MAX(orden) AS max_o
     FROM devoluciones WHERE orden >= 395`
  )
  .get();
console.log('A borrar:', antes);

const sample = db
  .prepare(
    `SELECT id, orden, codigo_escaneado, creado_en
     FROM devoluciones WHERE orden >= 395 ORDER BY orden`
  )
  .all();
console.log('Registros:', sample);

const tx = db.transaction(() => {
  const del = db.prepare(`DELETE FROM devoluciones WHERE orden >= 395`).run();
  db.prepare(
    `INSERT INTO contador_orden (id, siguiente) VALUES (1, 395)
     ON CONFLICT(id) DO UPDATE SET siguiente = 395`
  ).run();
  return del.changes;
});

const changes = tx.immediate();
console.log('Eliminados:', changes);

const despues = db
  .prepare(
    `SELECT COUNT(*) AS total, MAX(orden) AS ultimo
     FROM devoluciones`
  )
  .get();
const contador = db.prepare(`SELECT * FROM contador_orden`).get();
const siguientes = db
  .prepare(
    `SELECT COALESCE(MIN(t.orden), 0) + 1 AS siguiente
     FROM (
       SELECT orden FROM devoluciones WHERE orden IS NOT NULL
       UNION ALL
       SELECT 0
     ) t
     WHERE NOT EXISTS (
       SELECT 1 FROM devoluciones d WHERE d.orden = t.orden + 1
     )`
  )
  .get();

console.log('Después:', despues);
console.log('contador_orden:', contador);
console.log('próximo orden:', siguientes);
console.log(
  'últimos 5:',
  db
    .prepare(
      `SELECT id, orden, codigo_escaneado, creado_en
       FROM devoluciones ORDER BY orden DESC LIMIT 5`
    )
    .all()
);
db.close();
console.log('OK');
