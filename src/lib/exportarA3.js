/**
 * exportarA3.js
 * Genera un Excel compatible con A3 ECO (importación de Facturas Recibidas)
 * 
 * Dependencias: xlsx (SheetJS)  →  npm install xlsx
 * 
 * Uso:
 *   import { exportarA3 } from './exportarA3'
 *   exportarA3({ facturas, nombreEmpresa, periodoInicio, periodoFin })
 */

import * as XLSX from 'xlsx'

/**
 * @param {Object} opciones
 * @param {Array}  opciones.facturas        - Array de facturas validadas
 * @param {string} opciones.nombreEmpresa   - Nombre del cliente (ej: "YULIN HOME, S.L.")
 * @param {string} opciones.periodoInicio   - Texto inicio (ej: "01 Ene")
 * @param {string} opciones.periodoFin      - Texto fin    (ej: "31 Dic 2025")
 */
export function exportarA3({ facturas, nombreEmpresa, periodoInicio, periodoFin }) {
  const wb = XLSX.utils.book_new()
  const ws = {}

  // ── Helpers ──────────────────────────────────────────────────────────────
  const cell = (v, t = 'n') => ({ v, t })
  const cellStr = v => ({ v: v ?? '', t: 's' })
  const cellDate = v => {
    if (!v) return { v: '', t: 's' }
    const d = typeof v === 'string' ? parseDate(v) : v
    if (!d) return { v: '', t: 's' }
    // SheetJS: tipo 'd' con z (formato) = fecha nativa Excel
    return { v: d, t: 'd', z: 'dd/mm/yyyy' }
  }
  const cellNum = v => ({ v: parseFloat(v) || 0, t: 'n', z: '#,##0.00' })

  function parseDate(str) {
    if (!str) return null
    // Acepta DD/MM/YYYY o YYYY-MM-DD
    if (str.includes('/')) {
      const [d, m, y] = str.split('/').map(Number)
      return new Date(y, m - 1, d)
    }
    if (str.includes('-')) {
      const [y, m, d] = str.split('-').map(Number)
      return new Date(y, m - 1, d)
    }
    return null
  }

  const today = new Date()
  const todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`

  // ── Cabecera del informe ──────────────────────────────────────────────────
  const setCell = (ref, c) => { ws[ref] = c }

  setCell('A1', cellStr('Facturas Recibidas'))
  setCell('A3', cellStr(`Empresa: ${nombreEmpresa}`))
  setCell('A4', cellStr(`Período De ${periodoInicio} a ${periodoFin}`))
  setCell('A5', cellStr(`Fecha: ${todayStr}`))

  // ── Cabecera de columnas (fila 7) ─────────────────────────────────────────
  const headers = ['NºOrden','Núm.Fact.','F.Expe.','F.Oper.','Concepto','N.I.F.','Expedidor','Base Imponible','%IVA','Cuota','Deducible']
  headers.forEach((h, i) => {
    setCell(`${colLetter(i)}7`, cellStr(h))
  })

  // ── Filas de datos ────────────────────────────────────────────────────────
  let row = 8
  let orden = 1

  for (const f of facturas) {
    // Fila principal
    setCell(`A${row}`, cell(orden))
    setCell(`B${row}`, cellStr(f.num_factura))
    setCell(`C${row}`, cellDate(f.fecha_expedicion))
    setCell(`D${row}`, cellDate(f.fecha_operacion))
    setCell(`E${row}`, cellStr(f.concepto))
    setCell(`F${row}`, cellStr(f.nif_expedidor))
    setCell(`G${row}`, cellStr(f.expedidor))
    setCell(`H${row}`, cellNum(f.base_imponible))
    setCell(`I${row}`, cellStr(f.pct_iva || '21,0'))
    setCell(`J${row}`, cellNum(f.cuota))
    setCell(`K${row}`, cellNum(f.deducible))
    row++
    orden++

    // Líneas extra (IVA múltiple) — sin NºOrden
    for (const linea of (f.lineas_extra || [])) {
      setCell(`B${row}`, cellStr(f.num_factura))
      setCell(`C${row}`, cellDate(f.fecha_expedicion))
      setCell(`D${row}`, cellDate(f.fecha_operacion))
      setCell(`E${row}`, cellStr(f.concepto))
      setCell(`F${row}`, cellStr(f.nif_expedidor))
      setCell(`G${row}`, cellStr(f.expedidor))
      setCell(`H${row}`, cellNum(linea.base_imponible))
      setCell(`I${row}`, cellStr(linea.pct_iva || '0'))
      setCell(`J${row}`, cellNum(linea.cuota))
      setCell(`K${row}`, cellNum(linea.deducible))
      row++
    }
  }

  const dataEnd = row - 1

  // ── Totales (filas con fórmulas SUMIF, igual que A3 original) ────────────
  const totRow = row + 1

  setCell(`G${totRow}`,   cellStr('Total Período'))
  setCell(`H${totRow}`,   { t: 'n', f: `SUMIF(I8:I${dataEnd},I${totRow},H8:H${dataEnd})`, z: '#,##0.00' })
  setCell(`I${totRow}`,   cellStr('21,0'))
  setCell(`J${totRow}`,   { t: 'n', f: `SUMIF(I8:I${dataEnd},I${totRow},J8:J${dataEnd})`, z: '#,##0.00' })
  setCell(`K${totRow}`,   { t: 'n', f: `SUMIF(I8:I${dataEnd},I${totRow},K8:K${dataEnd})`, z: '#,##0.00' })

  setCell(`H${totRow+1}`, { t: 'n', f: `SUMIF(I8:I${dataEnd},I${totRow+1},H8:H${dataEnd})`, z: '#,##0.00' })
  setCell(`I${totRow+1}`, cellStr('0'))
  setCell(`J${totRow+1}`, { t: 'n', f: `SUMIF(I8:I${dataEnd},I${totRow+1},J8:J${dataEnd})`, z: '#,##0.00' })
  setCell(`K${totRow+1}`, { t: 'n', f: `SUMIF(I8:I${dataEnd},I${totRow+1},K8:K${dataEnd})`, z: '#,##0.00' })

  const tfRow = totRow + 3
  setCell(`G${tfRow}`, cellStr('Total Facturas'))
  setCell(`H${tfRow}`, { t: 'n', f: `SUM(H8:H${dataEnd})`, z: '#,##0.00' })
  setCell(`J${tfRow}`, { t: 'n', f: `SUM(J8:J${dataEnd})`, z: '#,##0.00' })
  setCell(`K${tfRow}`, { t: 'n', f: `SUM(K8:K${dataEnd})`, z: '#,##0.00' })

  // ── Rango de la hoja ──────────────────────────────────────────────────────
  ws['!ref'] = `A1:K${tfRow}`

  // ── Anchos de columna ─────────────────────────────────────────────────────
  ws['!cols'] = [
    { wch: 8  },  // A NºOrden
    { wch: 16 },  // B Núm.Fact.
    { wch: 12 },  // C F.Expe.
    { wch: 12 },  // D F.Oper.
    { wch: 40 },  // E Concepto
    { wch: 14 },  // F N.I.F.
    { wch: 35 },  // G Expedidor
    { wch: 16 },  // H Base Imponible
    { wch: 8  },  // I %IVA
    { wch: 14 },  // J Cuota
    { wch: 14 },  // K Deducible
  ]

  // ── Escribir y descargar ──────────────────────────────────────────────────
  XLSX.utils.book_append_sheet(wb, ws, 'Facturas')

  const nombreArchivo = `A3_${nombreEmpresa.replace(/[^a-zA-Z0-9]/g, '_')}_${periodoFin.replace(/\s/g, '')}.xlsx`
  XLSX.writeFile(wb, nombreArchivo)
}

// ── Utilidad: número de columna → letra (1=A, 2=B…) ──────────────────────────
function colLetter(i) {
  return String.fromCharCode(65 + i)
}
