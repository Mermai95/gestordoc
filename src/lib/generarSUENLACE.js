/**
 * generarSUENLACE.js
 * Genera el fichero SUENLACE.DAT en formato nativo A3 ECO
 * 
 * Formato: ASCII secuencial, 256 bytes por registro (254 + CR + LF)
 * Documentación: https://media.a3software.com/a3responde/files/5081-Enlace_contable_descripcion_registros_WEB.pdf
 * 
 * Para facturas recibidas genera por cada factura:
 *   - 1 registro tipo 1 (cabecera)
 *   - 1+ registros tipo 9 (detalle IVA, uno por cada tipo de IVA)
 */

/**
 * @param {Object} opciones
 * @param {Array}  opciones.facturas       - Facturas validadas de Supabase
 * @param {string} opciones.codigoEmpresa  - Código de empresa en A3 (ej: "00001")
 * @param {string} opciones.nombreEmpresa  - Nombre del cliente
 */
export function generarSUENLACE({ facturas, codigoEmpresa = '00001', nombreEmpresa = '' }) {
  const lineas = []

  for (const f of facturas) {
    const fecha       = formatFecha(f.fecha_expedicion)
    const fechaOper   = f.fecha_operacion ? formatFecha(f.fecha_operacion) : '        '
    const fechaFact   = formatFecha(f.fecha_expedicion)
    const numFact     = padRight(f.num_factura || '', 10)
    const concepto    = padRight(f.concepto || '', 30)
    const nif         = padRight(f.nif_expedidor || '', 14)
    const nombre      = padRight(f.expedidor || nombreEmpresa, 40)
    const codEmp      = padRight(codigoEmpresa, 5)

    // Importe total (base + cuota + lineas_extra)
    const totalBase  = parseFloat(f.base_imponible || 0)
    const totalCuota = parseFloat(f.cuota_iva || 0)
    let extraBase    = 0
    let extraCuota   = 0
    for (const linea of (f.lineas_extra || [])) {
      extraBase  += parseFloat(linea.base_imponible || 0)
      extraCuota += parseFloat(linea.cuota_iva || linea.cuota || 0)
    }
    const totalImporte = totalBase + totalCuota + extraBase + extraCuota

    // ── REGISTRO TIPO 1 — Cabecera factura recibida ────────────────────────
    // Cuenta proveedor: usamos 400 + primeros 9 chars del NIF (cuenta genérica)
    const cuentaProv = padRight('400' + (f.nif_expedidor || '').replace(/[^A-Z0-9]/gi, '').substring(0, 9), 12)

    let r1 = ''
    r1 += '4'                          // pos 1:    Tipo formato = 4
    r1 += codEmp                       // pos 2-6:  Código empresa
    r1 += fecha                        // pos 7-14: Fecha apunte aaaammdd
    r1 += '1'                          // pos 15:   Tipo registro = 1 (factura)
    r1 += cuentaProv                   // pos 16-27: Cuenta proveedor
    r1 += padRight(f.expedidor || '', 30)  // pos 28-57: Descripción cuenta
    r1 += '2'                          // pos 58:   Tipo factura = 2 (Compras)
    r1 += numFact                      // pos 59-68: Número factura
    r1 += 'I'                          // pos 69:   Línea apunte = I (inicio)
    r1 += concepto                     // pos 70-99: Descripción apunte
    r1 += formatImporte(totalImporte)  // pos 100-113: Importe total
    r1 += padRight('', 62)             // pos 114-175: Reserva
    r1 += nif                          // pos 176-189: NIF proveedor
    r1 += nombre                       // pos 190-229: Nombre proveedor
    r1 += padRight('', 5)              // pos 230-234: Código postal
    r1 += padRight('', 2)              // pos 235-236: Reserva
    r1 += fechaOper                    // pos 237-244: Fecha operación
    r1 += fechaFact                    // pos 245-252: Fecha factura
    r1 += 'E'                          // pos 253:   Moneda = Euros
    r1 += 'N'                          // pos 254:   Indicador generado

    lineas.push(padExact(r1, 254) + '\r\n')

    // ── REGISTRO TIPO 9 — Detalle IVA principal ────────────────────────────
    // Cuenta de compras: 600000000000 genérica
    const cuentaCompras = padRight('600000000000', 12)
    const pctIva        = formatPorcentaje(f.pct_iva || '21')
    const esUltima      = (f.lineas_extra || []).length === 0

    let r9 = ''
    r9 += '4'                          // pos 1:    Tipo formato
    r9 += codEmp                       // pos 2-6:  Código empresa
    r9 += fecha                        // pos 7-14: Fecha
    r9 += '9'                          // pos 15:   Tipo registro = 9
    r9 += cuentaCompras                // pos 16-27: Cuenta compras
    r9 += padRight('Compras', 30)      // pos 28-57: Descripción
    r9 += 'C'                          // pos 58:   Tipo importe = C (Cargo)
    r9 += numFact                      // pos 59-68: Número factura
    r9 += esUltima ? 'U' : 'M'        // pos 69:   U = último, M = medio
    r9 += concepto                     // pos 70-99: Descripción
    r9 += '01'                         // pos 100-101: Subtipo = 01 (interior IVA deducible)
    r9 += formatImporte(totalBase)     // pos 102-115: Base imponible
    r9 += pctIva                       // pos 116-120: % IVA
    r9 += formatImporte(totalCuota)    // pos 121-134: Cuota IVA
    r9 += '00.00'                      // pos 135-139: % Recargo
    r9 += formatImporte(0)             // pos 140-153: Cuota recargo
    r9 += '00.00'                      // pos 154-158: % Retención
    r9 += formatImporte(0)             // pos 159-172: Cuota retención
    r9 += '01'                         // pos 173-174: Impreso = 01 (347)
    r9 += 'S'                          // pos 175:   Sujeta a IVA
    r9 += ' '                          // pos 176:   Modelo 415
    r9 += ' '                          // pos 177:   Criterio caja
    r9 += padRight('', 14)             // pos 178-191: Reserva
    r9 += padRight('', 12)             // pos 192-203: Cuenta IVA (A3 la asigna auto)
    r9 += padRight('', 12)             // pos 204-215: Cuenta recargo
    r9 += padRight('', 12)             // pos 216-227: Cuenta retención
    r9 += padRight('', 12)             // pos 228-239: Cuenta IVA 2
    r9 += padRight('', 12)             // pos 240-251: Cuenta recargo 2
    r9 += ' '                          // pos 252:   Analítico
    r9 += 'E'                          // pos 253:   Moneda
    r9 += 'N'                          // pos 254:   Indicador

    lineas.push(padExact(r9, 254) + '\r\n')

    // ── REGISTROS TIPO 9 adicionales — líneas extra (IVA múltiple) ────────
    const extras = f.lineas_extra || []
    extras.forEach((linea, idx) => {
      const esUltimaLinea = idx === extras.length - 1
      const pctLinea      = formatPorcentaje(linea.pct_iva || '0')
      const baseLinea     = parseFloat(linea.base_imponible || 0)
      const cuotaLinea    = parseFloat(linea.cuota_iva || linea.cuota || 0)

      let r9x = ''
      r9x += '4'
      r9x += codEmp
      r9x += fecha
      r9x += '9'
      r9x += cuentaCompras
      r9x += padRight('Compras', 30)
      r9x += 'C'
      r9x += numFact
      r9x += esUltimaLinea ? 'U' : 'M'
      r9x += concepto
      r9x += '01'
      r9x += formatImporte(baseLinea)
      r9x += pctLinea
      r9x += formatImporte(cuotaLinea)
      r9x += '00.00'
      r9x += formatImporte(0)
      r9x += '00.00'
      r9x += formatImporte(0)
      r9x += '01'
      r9x += cuotaLinea > 0 ? 'S' : 'N'
      r9x += ' '
      r9x += ' '
      r9x += padRight('', 14)
      r9x += padRight('', 12)
      r9x += padRight('', 12)
      r9x += padRight('', 12)
      r9x += padRight('', 12)
      r9x += padRight('', 12)
      r9x += ' '
      r9x += 'E'
      r9x += 'N'

      lineas.push(padExact(r9x, 254) + '\r\n')
    })
  }

  // ── Generar y descargar el fichero ─────────────────────────────────────────
  const contenido = lineas.join('')
  const blob      = new Blob([contenido], { type: 'text/plain;charset=ascii' })
  const url       = URL.createObjectURL(blob)
  const a         = document.createElement('a')
  a.href          = url
  a.download      = 'SUENLACE.DAT'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Utilidades de formato ──────────────────────────────────────────────────────

/** Fecha Date|string → aaaammdd */
function formatFecha(fecha) {
  if (!fecha) return '        '
  const d = typeof fecha === 'string' ? new Date(fecha + 'T00:00:00') : fecha
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${dd}`
}

/** Importe → +0000001000.00 (14 chars) */
function formatImporte(valor) {
  const n   = parseFloat(valor) || 0
  const neg = n < 0
  const abs = Math.abs(n).toFixed(2)
  const [ent, dec] = abs.split('.')
  return (neg ? '-' : '+') + ent.padStart(10, '0') + '.' + dec
}

/** % IVA string|number → "21.00" (5 chars) */
function formatPorcentaje(pct) {
  const str = String(pct).replace(',', '.')
  const n   = parseFloat(str) || 0
  return n.toFixed(2).padStart(5, '0')
}

/** Padding derecha con espacios */
function padRight(str, len) {
  return String(str || '').substring(0, len).padEnd(len, ' ')
}

/** Asegura exactamente N chars rellenando con espacios */
function padExact(str, len) {
  if (str.length >= len) return str.substring(0, len)
  return str.padEnd(len, ' ')
}
