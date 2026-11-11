import sql from 'mssql';

let poolPromise = null;

function buildConfig() {
  return {
    server: process.env.MSSQL_SERVER || '10.6.1.235',
    port: Number(process.env.MSSQL_PORT || 1433),
    database: process.env.MSSQL_DATABASE || 'CEDIS',
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    options: {
      encrypt: String(process.env.MSSQL_ENCRYPT || 'false') === 'true',
      trustServerCertificate:
        String(process.env.MSSQL_TRUST_CERT || 'true') === 'true',
      enableArithAbort: true,
    },
    connectionTimeout: 8000,
    requestTimeout: 20000,
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

export function isCedisConfigured() {
  return Boolean(process.env.MSSQL_USER && process.env.MSSQL_PASSWORD);
}

export async function getCedisPool() {
  if (!isCedisConfigured()) {
    throw new Error('CEDIS no configurado: faltan MSSQL_USER / MSSQL_PASSWORD');
  }
  if (!poolPromise) {
    poolPromise = sql.connect(buildConfig()).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

export async function pingCedis() {
  if (!isCedisConfigured()) {
    return { ok: false, configured: false, error: 'Credenciales no configuradas' };
  }
  try {
    const pool = await getCedisPool();
    const result = await pool.request().query('SELECT 1 AS ok');
    return {
      ok: result.recordset?.[0]?.ok === 1,
      configured: true,
      server: process.env.MSSQL_SERVER,
      database: process.env.MSSQL_DATABASE,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      server: process.env.MSSQL_SERVER,
      database: process.env.MSSQL_DATABASE,
      error: err.message,
    };
  }
}

function mapProductoRow(row) {
  if (!row) return null;
  return {
    Articulo: String(row.Articulo ?? '').trim(),
    CodigoBarra: String(row.CodigoBarra ?? '').trim(),
    ITEMDESC: String(row.ITEMDESC ?? '').trim(),
    Cantidad: Number(row.Cantidad ?? 1),
    UdM: String(row.UdM ?? 'UND').trim() || 'UND',
    /** Costo unitario (CURRCOST de CORP) */
    CurrCost: Number(row.CURRCOST ?? row.CurrCost ?? 0),
  };
}

/**
 * Busca artículo/serial en CORP vía linked server (costo unitario CURRCOST).
 * Query oficial:
 *   MTX_IVTrx_seriales_IPV ⋈ iv00101  WHERE Articulo|CodigoBarra = @serial
 */
async function queryCorpBySerial(pool, serial) {
  const result = await pool
    .request()
    .input('serial', sql.VarChar(500), serial)
    .query(`
      SELECT TOP 1
        S.[Articulo],
        S.[CodigoBarra],
        RTRIM(I.[ITEMDESC]) AS ITEMDESC,
        S.[Cantidad],
        S.[UdM],
        I.[CURRCOST] AS CURRCOST
      FROM [DYNAMICS\\GPSP2].[CORP].[dbo].[MTX_IVTrx_seriales_IPV] S
      INNER JOIN [DYNAMICS\\GPSP2].[CORP].[dbo].[iv00101] I
        ON S.[Articulo] = I.[itemnmbr]
      WHERE S.[Articulo] = RTRIM(@serial)
         OR S.[CodigoBarra] = RTRIM(@serial)
      ORDER BY
        CASE
          WHEN S.[CodigoBarra] = RTRIM(@serial) THEN 0
          WHEN S.[Articulo] = RTRIM(@serial) THEN 1
          ELSE 2
        END
    `);
  return mapProductoRow(result.recordset?.[0]);
}

/**
 * Busca artículo por Articulo o CodigoBarra en CORP (linked).
 * Fallback: quita ceros a la izquierda del serial (a veces la barra no lleva el 0).
 * @returns {Promise<null | { Articulo, CodigoBarra, ITEMDESC, Cantidad, UdM, CurrCost }>}
 */
export async function buscarProductoCedis(serial) {
  const codigo = String(serial ?? '').trim();
  if (!codigo) return null;

  const pool = await getCedisPool();
  let row = await queryCorpBySerial(pool, codigo);
  let matchMode = row ? 'exact' : null;

  if (!row) {
    const sinCeros = codigo.replace(/^0+/, '');
    if (sinCeros && sinCeros !== codigo) {
      row = await queryCorpBySerial(pool, sinCeros);
      if (row) matchMode = 'strip-leading-zeros';
    }
  }

  return row;
}
