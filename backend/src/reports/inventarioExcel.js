import ExcelJS from 'exceljs';

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F766E' },
};
const TITLE_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF134E4A' },
};
const HEADER_FONT = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  name: 'Calibri',
  size: 11,
};
const TITLE_FONT = {
  bold: true,
  name: 'Calibri',
  size: 18,
  color: { argb: 'FFFFFFFF' },
};
const SUB_FONT = { name: 'Calibri', size: 10, color: { argb: 'FF475569' } };
const TOTAL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFCCFBF1' },
};
const ZEBRA_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF0FDFA' },
};
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF99F6E4' } },
  left: { style: 'thin', color: { argb: 'FF99F6E4' } },
  bottom: { style: 'thin', color: { argb: 'FF99F6E4' } },
  right: { style: 'thin', color: { argb: 'FF99F6E4' } },
};

function styleHeaderRow(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });
}

function styleDataRow(row, zebra) {
  row.height = 20;
  row.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10 };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle' };
    if (zebra) cell.fill = ZEBRA_FILL;
  });
}

function styleTitleBanner(sheet, mergeRange, text) {
  sheet.mergeCells(mergeRange);
  const cell = sheet.getCell(mergeRange.split(':')[0]);
  cell.value = text;
  cell.font = TITLE_FONT;
  cell.fill = TITLE_FILL;
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(cell.row).height = 34;
}

function styleGlobalRow(row, cols) {
  row.height = 26;
  for (let col = 1; col <= cols; col += 1) {
    const cell = row.getCell(col);
    cell.fill = TOTAL_FILL;
    cell.font = { bold: true, name: 'Calibri', size: 12, color: { argb: 'FF134E4A' } };
    cell.border = THIN_BORDER;
    cell.alignment = {
      vertical: 'middle',
      horizontal: col === cols ? 'center' : 'left',
    };
  }
}

/** Cada escaneo/código cuenta como cantidad 1 */
function totalesPorCodigo(items) {
  const map = new Map();
  for (const item of items) {
    const codigo = String(
      item.Articulo || item.CodigoBarra || item.codigo_escaneado || '—'
    ).trim();
    const desc = String(item.ITEMDESC || '—').trim();
    const prev = map.get(codigo);
    if (prev) {
      prev.cantidad += 1;
      if (prev.descripcion === '—' && desc !== '—') prev.descripcion = desc;
    } else {
      map.set(codigo, { codigo, descripcion: desc, cantidad: 1 });
    }
  }
  return [...map.values()].sort((a, b) =>
    String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true })
  );
}

function totalesPorEstatus(items) {
  const map = new Map();
  for (const item of items) {
    const estatus = String(item.estatus_nombre || 'Sin estatus').trim();
    map.set(estatus, (map.get(estatus) || 0) + 1);
  }
  return [...map.entries()]
    .map(([estatus, cantidad]) => ({ estatus, cantidad }))
    .sort((a, b) => String(a.estatus).localeCompare(String(b.estatus), 'es'));
}

/**
 * @param {object[]} items
 * @param {{ filtroTienda?: string, filtroQ?: string }} _meta
 */
export async function buildInventarioWorkbook(items, _meta = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'App Escaneo Inventario';
  workbook.created = new Date();

  // —— Hoja 1: Detalle ——
  const sheet = workbook.addWorksheet('Inventario', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  sheet.columns = [
    { key: 'n', width: 8 },
    { key: 'codigo', width: 16 },
    { key: 'descripcion', width: 48 },
    { key: 'sku', width: 16 },
    { key: 'tienda', width: 24 },
    { key: 'estatus', width: 28 },
    { key: 'cantidad', width: 12 },
    { key: 'udm', width: 8 },
  ];

  styleTitleBanner(sheet, 'A1:H1', 'REPORTE DE INVENTARIO');
  sheet.getRow(2).height = 6;

  const header = sheet.getRow(3);
  header.values = [
    'N°',
    'Código',
    'Descripción',
    'SKU',
    'Tienda',
    'Estatus',
    'Cantidad',
    'UdM',
  ];
  styleHeaderRow(header);

  let rowIdx = 4;
  items.forEach((item, i) => {
    const row = sheet.getRow(rowIdx);
    const tienda = item.sucursal_codigo
      ? `${item.sucursal_codigo}${item.sucursal_nombre ? ` - ${item.sucursal_nombre}` : ''}`
      : item.sucursal_nombre || '—';
    row.values = [
      item.orden ?? i + 1,
      item.Articulo || '—',
      item.ITEMDESC || '—',
      item.CodigoBarra || item.codigo_escaneado || '—',
      tienda,
      item.estatus_nombre || '—',
      1,
      item.UdM || 'UND',
    ];
    styleDataRow(row, i % 2 === 1);
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.getCell(6).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };
    rowIdx += 1;
  });

  if (!items.length) {
    const empty = sheet.getRow(rowIdx);
    empty.getCell(1).value = 'Sin registros para los filtros actuales.';
    sheet.mergeCells(`A${rowIdx}:H${rowIdx}`);
    empty.getCell(1).font = SUB_FONT;
  }

  if (items.length) {
    sheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3 + items.length, column: 8 },
    };
  }

  // —— Hoja 2: Totales por código ——
  const totCodigo = workbook.addWorksheet('Totales por código', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });
  totCodigo.columns = [
    { key: 'codigo', width: 22 },
    { key: 'descripcion', width: 72 },
    { key: 'cantidad', width: 14 },
  ];

  styleTitleBanner(totCodigo, 'A1:C1', 'TOTALES POR CÓDIGO');
  totCodigo.getRow(2).height = 6;

  const codHeader = totCodigo.getRow(3);
  codHeader.values = ['Código', 'Descripción', 'Cantidad'];
  styleHeaderRow(codHeader);

  const gruposCodigo = totalesPorCodigo(items);
  let totalCantidad = 0;
  let codRow = 4;
  gruposCodigo.forEach((g, i) => {
    const row = totCodigo.getRow(codRow);
    row.values = [g.codigo, g.descripcion, g.cantidad];
    styleDataRow(row, i % 2 === 1);
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
    const lines = Math.max(
      1,
      Math.ceil(String(g.codigo || '').length / 20),
      Math.ceil(String(g.descripcion || '').length / 70)
    );
    row.height = Math.max(22, lines * 15);
    totalCantidad += g.cantidad;
    codRow += 1;
  });

  if (!gruposCodigo.length) {
    const empty = totCodigo.getRow(codRow);
    empty.getCell(1).value = 'Sin totales por código.';
    totCodigo.mergeCells(`A${codRow}:C${codRow}`);
    empty.getCell(1).font = SUB_FONT;
    codRow += 1;
  }

  const globalCodigo = totCodigo.getRow(codRow);
  globalCodigo.values = ['TOTAL GLOBAL', '', totalCantidad];
  styleGlobalRow(globalCodigo, 3);
  totCodigo.mergeCells(`A${codRow}:B${codRow}`);

  // —— Hoja 3: Totales por estatus ——
  const totEstatus = workbook.addWorksheet('Totales por estatus', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });
  totEstatus.columns = [
    { key: 'estatus', width: 40 },
    { key: 'cantidad', width: 14 },
  ];

  styleTitleBanner(totEstatus, 'A1:B1', 'TOTALES POR ESTATUS');
  totEstatus.getRow(2).height = 6;

  const estHeader = totEstatus.getRow(3);
  estHeader.values = ['Estatus', 'Cantidad'];
  styleHeaderRow(estHeader);

  const gruposEstatus = totalesPorEstatus(items);
  let totalEstatus = 0;
  let estRow = 4;
  gruposEstatus.forEach((g, i) => {
    const row = totEstatus.getRow(estRow);
    row.values = [g.estatus, g.cantidad];
    styleDataRow(row, i % 2 === 1);
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    const lines = Math.max(1, Math.ceil(String(g.estatus || '').length / 38));
    row.height = Math.max(22, lines * 15);
    totalEstatus += g.cantidad;
    estRow += 1;
  });

  if (!gruposEstatus.length) {
    const empty = totEstatus.getRow(estRow);
    empty.getCell(1).value = 'Sin totales por estatus.';
    totEstatus.mergeCells(`A${estRow}:B${estRow}`);
    empty.getCell(1).font = SUB_FONT;
    estRow += 1;
  }

  const globalEstatus = totEstatus.getRow(estRow);
  globalEstatus.values = ['TOTAL GLOBAL', totalEstatus];
  styleGlobalRow(globalEstatus, 2);

  return workbook;
}
