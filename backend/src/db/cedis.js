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
    requestTimeout: 12000,
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

/**
 * Busca artículo por Articulo o CodigoBarra (query CEDIS).
 * @returns {Promise<null | { Articulo, CodigoBarra, ITEMDESC, Cantidad, UdM }>}
 */
export async function buscarProductoCedis(serial) {
  const codigo = String(serial ?? '').trim();
  if (!codigo) return null;

  const pool = await getCedisPool();
  const result = await pool
    .request()
    .input('serial', sql.VarChar(500), codigo)
    .query(`
      SELECT TOP 1
        S.[Articulo],
        S.[CodigoBarra],
        RTRIM(I.[ITEMDESC]) AS ITEMDESC,
        S.[Cantidad],
        S.[UdM]
      FROM [dbo].[MTX_IVTrx_seriales_IPV] S
      INNER JOIN [dbo].[iv00101] I
        ON S.[Articulo] = I.[itemnmbr]
      WHERE S.[Articulo] = RTRIM(@serial)
         OR S.[CodigoBarra] = RTRIM(@serial)
    `);

  const row = result.recordset?.[0];
  if (!row) return null;

  return {
    Articulo: String(row.Articulo ?? '').trim(),
    CodigoBarra: String(row.CodigoBarra ?? '').trim(),
    ITEMDESC: String(row.ITEMDESC ?? '').trim(),
    Cantidad: Number(row.Cantidad ?? 1),
    UdM: String(row.UdM ?? 'UND').trim() || 'UND',
  };
}
