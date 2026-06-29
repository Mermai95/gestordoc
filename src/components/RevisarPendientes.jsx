import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { PDFDocument } from 'pdf-lib'
import PdfViewer from './PdfViewer'
import { useGuardarCorreccion } from '../hooks/useGuardarCorreccion'

const CODIGOS_IVA = [
  { codigo: '2', pct: '21,0', label: '2 — 21%' },
  { codigo: '1', pct: '10,0', label: '1 — 10%' },
  { codigo: '5', pct: '4,0',  label: '5 — 4%'  },
  { codigo: '3', pct: '21,0', label: '3 — 21% (RE)' },
  { codigo: '0', pct: '0,0',  label: '0 — Exento' },
]

const ANIO_ACTUAL = new Date().getFullYear()

// Definición de columnas (key estable para identificarlas)
const COLS_DEFAULT = [
  { key: 'estado',     label: 'Estado',                      w: 50 },
  { key: 'situacion', label: 'Situación',                   w: 110 },
  { key: 'empresa',   label: 'Empresa',                     w: 180 },
  { key: 'fecha',   label: 'Fecha',                        w: 90 },
  { key: 'num',     label: 'Nº Factura',                   w: 120 },
  { key: 'total',   label: 'Total',                        w: 90, align: 'right' },
  { key: 'tipo',    label: 'Tipo',                         w: 80 },
  { key: 'obs',     label: 'Observaciones / Incidencias',  w: 200 },
]
const COL_STORAGE = 'gestordoc_cols_v3'

function loadCols() {
  try {
    const saved = localStorage.getItem(COL_STORAGE)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length === COLS_DEFAULT.length) {
        // Validar que tenga todas las keys conocidas
        const keysOk = parsed.every(c => COLS_DEFAULT.find(d => d.key === c.key))
        if (keysOk) {
          // Mergear con defaults para recuperar label/align si cambia algo
          return parsed.map(c => ({ ...COLS_DEFAULT.find(d => d.key === c.key), ...c }))
        }
      }
    }
  } catch(e) {}
  return COLS_DEFAULT.map(c => ({ ...c }))
}

function detectarEjercicio(fecha) {
  if (!fecha) return null
  const anio = new Date(fecha).getFullYear()
  if (isNaN(anio)) return null
  if (anio < ANIO_ACTUAL) return `Ejercicio ${anio} — año anterior`
  if (anio > ANIO_ACTUAL) return `Ejercicio ${anio} — año futuro`
  return null
}

export default function RevisarPendientes({ clienteId, onCerrar, onValidada }) {
  const [facturas,     setFacturas]     = useState([])
  const [seleccionId,  setSeleccionId]  = useState(null)
  const [guardando,    setGuardando]    = useState(false)
  const [pdfUrl,       setPdfUrl]       = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [revisadas,    setRevisadas]    = useState(0)
  const [totalInicial, setTotalInicial] = useState(0)
  const [flash,        setFlash]        = useState(false)
  const [cols, setCols] = useState(loadCols)
  const [selMultiple,  setSelMultiple]  = useState([])
  const originalesRef   = useRef({})
  const { registrarCorreccion } = useGuardarCorreccion()
  const resizingRef     = useRef(null)
  const draggedColRef   = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  const seleccionada   = facturas.find(f => f.id === seleccionId) || null
  const avisoEjercicio = seleccionada ? detectarEjercicio(seleccionada.fecha_expedicion) : null

  useEffect(() => { fetchPendientes() }, [clienteId])
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  useEffect(() => {
    if (seleccionada?.archivo_url) cargarPdf(seleccionada.archivo_url)
    else setPdfUrl(null)
  }, [seleccionId])

  // Guardar cols (orden + anchos) en localStorage
  useEffect(() => {
    try { localStorage.setItem(COL_STORAGE, JSON.stringify(cols)) } catch(e) {}
  }, [cols])

  // Resize de columna por índice
  const onResizeStart = useCallback((e, idx) => {
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = { idx, startX: e.clientX, startW: cols[idx].w }

    function onMove(ev) {
      if (!resizingRef.current) return
      const { idx: i, startX, startW } = resizingRef.current
      const newW = Math.max(40, startW + (ev.clientX - startX))
      setCols(cs => { const n = [...cs]; n[i] = { ...n[i], w: newW }; return n })
    }
    function onUp() {
      resizingRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [cols])

  // Drag para reordenar columnas
  function onDragStart(e, idx) {
    draggedColRef.current = idx
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))  // requerido en Firefox
  }
  function onDragOver(e, idx) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIdx !== idx) setDragOverIdx(idx)
  }
  function onDragLeave() { setDragOverIdx(null) }
  function onDrop(e, idx) {
    e.preventDefault()
    const fromIdx = draggedColRef.current
    setDragOverIdx(null)
    if (fromIdx == null || fromIdx === idx) return
    setCols(cs => {
      const nuevas = [...cs]
      const [moved] = nuevas.splice(fromIdx, 1)
      nuevas.splice(idx, 0, moved)
      return nuevas
    })
    draggedColRef.current = null
  }
  function onDragEnd() {
    draggedColRef.current = null
    setDragOverIdx(null)
  }

  async function fetchPendientes() {
    setLoading(true)
    const { data } = await supabase
      .from('facturas').select('*')
      .eq('cliente_id', clienteId).in('estado', ['pendiente', 'procesada', 'revisar'])
      .order('created_at', { ascending: false })
    const list = data ?? []
    const snap = {}
    list.forEach(f => { snap[f.id] = { ...f } })
    originalesRef.current = snap
    setFacturas(list)
    setTotalInicial(list.length)
    if (list.length > 0) setSeleccionId(list[0].id)
    setLoading(false)
  }

  function toggleSelMultiple(id) {
    setSelMultiple(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  async function unirFacturas() {
    if (selMultiple.length < 2 || guardando) return
    setGuardando(true)
    const seleccionadas = facturas.filter(f => selMultiple.includes(f.id))
    const base = seleccionadas[0]

    function mejorValor(campo) {
      for (const f of seleccionadas) {
        const v = f[campo]
        if (v && v !== '0' && v !== 0 && v !== '' && v !== '0.00') return v
      }
      return base[campo]
    }

    const paginaConTotales = [...seleccionadas].reverse().find(f =>
      parseFloat(f.base_imponible) > 0
    ) || base

    try {
      const pdfUnido = await PDFDocument.create()
      for (const fila of seleccionadas) {
        try {
          const { data } = supabase.storage.from('facturas').getPublicUrl(fila.archivo_url)
          const response = await fetch(data.publicUrl)
          const buf = await response.arrayBuffer()
          const doc = await PDFDocument.load(buf)
          const pages = await pdfUnido.copyPages(doc, doc.getPageIndices())
          pages.forEach(p => pdfUnido.addPage(p))
        } catch (e) { console.warn('No se pudo fusionar página:', e) }
      }
      const pdfBytes = await pdfUnido.save()
      const pdfBlob  = new Blob([pdfBytes], { type: 'application/pdf' })
      const pdfFile  = new File([pdfBlob], `unido_${base.id}.pdf`, { type: 'application/pdf' })

      const rutaUnida = base.archivo_url.replace(/\.[^.]+$/, '_unido.pdf')
      const { error: uploadErr } = await supabase.storage.from('facturas').upload(rutaUnida, pdfFile, { upsert: true })
      if (uploadErr) console.error('[unir] upload error:', uploadErr, 'ruta:', rutaUnida)

      const datosUnidos = {
        num_factura:      mejorValor('num_factura'),
        fecha_expedicion: mejorValor('fecha_expedicion'),
        fecha_operacion:  mejorValor('fecha_operacion'),
        concepto:         mejorValor('concepto'),
        nif_expedidor:    mejorValor('nif_expedidor'),
        expedidor:        mejorValor('expedidor'),
        base_imponible:   parseFloat(paginaConTotales.base_imponible) || 0,
        pct_iva:          paginaConTotales.pct_iva || mejorValor('pct_iva'),
        cuota_iva:        parseFloat(paginaConTotales.cuota_iva) || 0,
        deducible:        parseFloat(paginaConTotales.deducible) || 0,
        lineas_extra:     paginaConTotales.lineas_extra || base.lineas_extra || [],
        archivo_url:      rutaUnida,
      }
      await supabase.from('facturas').update(datosUnidos).eq('id', base.id)

      const otrosIds = seleccionadas.filter(f => f.id !== base.id).map(f => f.id)
      if (otrosIds.length > 0) {
        await supabase.from('facturas').delete().in('id', otrosIds)
      }

      setFacturas(fs => {
        const nuevas = fs.filter(f => !otrosIds.includes(f.id))
        return nuevas.map(f => f.id === base.id ? { ...f, ...datosUnidos } : f)
      })
      setSeleccionId(base.id)
      setSelMultiple([])
      setPdfUrl(URL.createObjectURL(pdfBlob))
    } catch (err) {
      console.error('Error uniendo facturas:', err)
    }
    setGuardando(false)
  }

  function cargarPdf(archivo_url) {
    setPdfUrl(null)
    try {
      const { data } = supabase.storage.from('facturas').getPublicUrl(archivo_url)
      if (data?.publicUrl) setPdfUrl(data.publicUrl + '?t=' + Date.now())
    } catch (err) { console.error(err) }
  }

  function editarCampo(campo, valor) {
    setFacturas(fs => fs.map(f => {
      if (f.id !== seleccionId) return f
      const u = { ...f, [campo]: valor }
      if (campo === 'base_imponible' || campo === 'pct_iva') {
        const base  = parseFloat(campo === 'base_imponible' ? valor : f.base_imponible) || 0
        const pct   = parseFloat((campo === 'pct_iva' ? valor : f.pct_iva)?.toString().replace(',', '.')) || 0
        const cuota = Math.round(base * pct / 100 * 100) / 100
        u.cuota_iva = cuota.toFixed(2)
        u.deducible = cuota.toFixed(2)
      }
      return u
    }))
  }

  function editarLineaExtra(idx, campo, valor) {
    setFacturas(fs => fs.map(f => {
      if (f.id !== seleccionId) return f
      const lineas = [...(f.lineas_extra || [])]
      lineas[idx] = { ...lineas[idx], [campo]: valor }
      if (campo === 'base_imponible' || campo === 'pct_iva') {
        const base  = parseFloat(campo === 'base_imponible' ? valor : lineas[idx].base_imponible) || 0
        const pct   = parseFloat((campo === 'pct_iva' ? valor : lineas[idx].pct_iva)?.toString().replace(',', '.')) || 0
        const cuota = Math.round(base * pct / 100 * 100) / 100
        lineas[idx].cuota_iva = cuota.toFixed(2)
        lineas[idx].deducible = cuota.toFixed(2)
      }
      return { ...f, lineas_extra: lineas }
    }))
  }

  function agregarLineaIva(codigoObj) {
    setFacturas(fs => fs.map(f => {
      if (f.id !== seleccionId) return f
      const nuevaLinea = { codigo: codigoObj.codigo, base_imponible: '0.00', pct_iva: codigoObj.pct, cuota_iva: '0.00', deducible: '0.00' }
      return { ...f, lineas_extra: [...(f.lineas_extra || []), nuevaLinea] }
    }))
  }

  function eliminarLineaExtra(idx) {
    setFacturas(fs => fs.map(f => {
      if (f.id !== seleccionId) return f
      return { ...f, lineas_extra: (f.lineas_extra || []).filter((_, i) => i !== idx) }
    }))
  }

  const parseDate = str => {
    if (!str) return null
    if (str.toString().includes('/')) {
      const [d, m, y] = str.split('/').map(Number)
      return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    }
    return str
  }

  async function validarFactura() {
    if (!seleccionada || guardando) return
    setGuardando(true)
    const f = seleccionada
    const { error } = await supabase.from('facturas').update({
      estado: 'validada',
      num_factura:      f.num_factura || null,
      fecha_expedicion: parseDate(f.fecha_expedicion),
      fecha_operacion:  parseDate(f.fecha_operacion),
      concepto:         f.concepto || null,
      nif_expedidor:    f.nif_expedidor || null,
      expedidor:        f.expedidor || null,
      base_imponible:   parseFloat(f.base_imponible) || 0,
      pct_iva:          f.pct_iva || '21,0',
      cuota_iva:        parseFloat(f.cuota_iva) || 0,
      deducible:        parseFloat(f.deducible) || 0,
      lineas_extra:     f.lineas_extra || [],
    }).eq('id', f.id)
    if (!error) {
      const orig = originalesRef.current[f.id]
      if (orig) {
        const campos = ['num_factura','expedidor','nif_expedidor','fecha_expedicion','fecha_operacion','concepto','base_imponible','pct_iva','cuota_iva','deducible']
        const nif = f.nif_expedidor || orig.nif_expedidor
        campos.forEach(campo => {
          registrarCorreccion({
            facturaId: f.id,
            nifExpedidor: nif,
            campo,
            valorOriginal: orig[campo],
            valorNuevo: f[campo],
          })
        })
      }
      setRevisadas(r => r + 1)
      setFlash(true)
      setTimeout(() => setFlash(false), 500)
      const restantes = facturas.filter(x => x.id !== f.id)
      setFacturas(restantes)
      onValidada?.()
      if (restantes.length > 0) setSeleccionId(restantes[0].id)
      else onCerrar?.()
    }
    setGuardando(false)
  }

  async function descartarFactura() {
    if (!seleccionada || guardando) return
    setGuardando(true)
    await supabase.from('facturas').update({ estado: 'error' }).eq('id', seleccionada.id)
    const restantes = facturas.filter(x => x.id !== seleccionada.id)
    setFacturas(restantes)
    if (restantes.length > 0) setSeleccionId(restantes[0].id)
    else onCerrar?.()
    setGuardando(false)
  }

  const totalFactura = seleccionada
    ? (parseFloat(seleccionada.base_imponible) || 0)
    + (parseFloat(seleccionada.cuota_iva) || 0)
    + (seleccionada.lineas_extra || []).reduce((s, l) =>
        s + (parseFloat(l.base_imponible) || 0) + (parseFloat(l.cuota_iva) || 0), 0)
    : 0

  const bolitaColor = conf => ({ alta: '#22A722', media: '#F5A623', baja: '#E2401B' }[conf] || '#9B9B9B')
  const progreso    = totalInicial > 0 ? Math.round((revisadas / totalInicial) * 100) : 0

  if (loading) return (
    <div style={{ ...s.shell, alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#9B9B9B' }}>Cargando pendientes…</p>
    </div>
  )

  if (facturas.length === 0) return (
    <div style={{ ...s.shell, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '3rem' }}>✓</div>
      <p style={{ color: '#22A722', fontWeight: 700, fontSize: '1.1rem' }}>Bandeja limpia</p>
      {revisadas > 0 && <p style={{ color: '#6B6B6B', fontSize: '0.88rem' }}>Revisaste {revisadas} factura{revisadas !== 1 ? 's' : ''} 🔥</p>}
      <button onClick={onCerrar} style={s.btnVolver}>Volver</button>
    </div>
  )

  return (
    <div style={s.shell}>

      {/* BARRA SUPERIOR */}
      <div style={s.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onCerrar} style={s.btnVolverTop}>← Volver</button>
          <span style={s.topTitle}>Identificación de facturas</span>
          <span style={s.topMeta}>
            {facturas.length} pendiente{facturas.length !== 1 ? 's' : ''}
            {revisadas > 0 ? ' · ' + revisadas + ' revisada' + (revisadas !== 1 ? 's' : '') : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {totalInicial > 1 && (
            <div style={s.progWrap}>
              <div style={{ ...s.progBar, width: progreso + '%' }} />
            </div>
          )}
          <button onClick={onCerrar} style={s.btnCerrar}>✕ Cerrar</button>
        </div>
      </div>

      {/* MARGEN */}
      <div style={{ height: '16px', background: '#F0EEE8', borderBottom: '1px solid #D8D4CB', flexShrink: 0 }} />

      {/* CUERPO */}
      <div style={s.body}>

        {/* IZQUIERDA */}
        <div style={s.leftPane}>

          {/* Tabla con columnas redimensionables y reordenables */}
          <div style={s.listaBox}>
            <table style={{ ...s.tabla, width: cols.reduce((a, c) => a + c.w, 0) + 'px' }}>
              <thead>
                <tr>
                  {cols.map((col, idx) => (
                    <th
                      key={col.key}
                      style={{
                        ...s.th,
                        width: col.w + 'px',
                        position: 'relative',
                        textAlign: col.align || 'left',
                      }}
                    >
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none', paddingRight: '8px' }}>
                        {col.label}
                      </span>
                      <div
                        style={s.resizer}
                        onMouseDown={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const startW = cols[idx].w
                          function onMove(ev) {
                            const newW = Math.max(40, startW + (ev.clientX - startX))
                            setCols(cs => { const n = [...cs]; n[idx] = { ...n[idx], w: newW }; return n })
                          }
                          function onUp() {
                            document.removeEventListener('mousemove', onMove)
                            document.removeEventListener('mouseup', onUp)
                            document.body.style.cursor     = ''
                            document.body.style.userSelect = ''
                          }
                          document.body.style.cursor     = 'col-resize'
                          document.body.style.userSelect = 'none'
                          document.addEventListener('mousemove', onMove)
                          document.addEventListener('mouseup', onUp)
                        }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facturas.map(f => {
                  const isSel       = f.id === seleccionId
                  const isMarcada   = selMultiple.includes(f.id)
                  const total       = (parseFloat(f.base_imponible) || 0) + (parseFloat(f.cuota_iva) || 0)
                  const esAbono     = f.tipo === 'abono' || total < 0
                  const aviso       = detectarEjercicio(f.fecha_expedicion)
                  const avisoCorto  = aviso ? 'Ej. anterior ⚠' : ''
                  const tienePagina = !!f.ia_raw?.notas

                  const estadoBadge = { procesada: s.badgeProcesada, revisar: s.badgeRevisar, pendiente: s.badgePendiente }
                  function celda(key) {
                    switch (key) {
                      case 'estado':  return <span style={{ ...s.bolita, background: bolitaColor(f.ia_confianza) }} />
                      case 'situacion': return (
                        <div>
                          <span style={estadoBadge[f.estado] || s.badgePendiente}>
                            {f.estado || 'pendiente'}
                          </span>
                          {isMarcada && <span style={s.marcadaBadge}>✓ sel.</span>}
                          {f.estado === 'revisar' && f.motivo_revision && (
                            <div style={s.motivoTexto}>{f.motivo_revision}</div>
                          )}
                        </div>
                      )
                      case 'empresa': return f.expedidor || '—'
                      case 'fecha':   return f.fecha_expedicion ? new Date(f.fecha_expedicion).toLocaleDateString('es-ES') : '—'
                      case 'num':     return f.num_factura || '—'
                      case 'total':   return total.toFixed(2)
                      case 'tipo':    return esAbono ? 'Abono' : 'Recibida'
                      case 'obs':     return (
                        <>
                          {tienePagina && <span style={s.paginaAviso}>⚠ Pág. múltiple</span>}
                          {avisoCorto ? ` ${avisoCorto}` : ''}
                        </>
                      )
                      default:        return ''
                    }
                  }
                  function styleCelda(col) {
                    const base = { ...s.td, width: col.w + 'px', textAlign: col.align || 'left' }
                    if (isMarcada) base.background = '#E3F2FD'
                    if (aviso && !isSel) base.background = '#FFF3E0'
                    if (isSel) base.background = '#C9E8F5'
                    switch (col.key) {
                      case 'estado':    return { ...base, textAlign: 'center' }
                      case 'situacion': return { ...base, textAlign: 'center', whiteSpace: 'normal', overflow: 'visible' }
                      case 'empresa': return { ...base, fontWeight: isSel ? 700 : 400 }
                      case 'num':     return { ...base, fontFamily: 'monospace', fontSize: '0.77rem' }
                      case 'total':   return { ...base, textAlign: 'right', color: esAbono ? '#E2401B' : '#1C1C1C', fontWeight: 600 }
                      case 'obs':     return { ...base, color: avisoCorto ? '#C05000' : '#6B6B6B', fontSize: '0.73rem' }
                      default:        return base
                    }
                  }

                  return (
                    <tr key={f.id} onClick={e => {
                      if (e.metaKey || e.ctrlKey) toggleSelMultiple(f.id)
                      else setSeleccionId(f.id)
                    }}
                      style={{ ...s.tr, ...(isSel ? s.trSel : {}), ...(aviso ? s.trAviso : {}), ...(isMarcada ? s.trMarcada : {}) }}>
                      {cols.map(col => (
                        <td key={col.key} style={styleCelda(col)}>
                          {celda(col.key)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Unir páginas */}
          <div style={s.unirBar}>
            {selMultiple.length >= 2 ? (
              <button onClick={unirFacturas} disabled={guardando} style={s.btnUnir}>
                🔗 Unir {selMultiple.length} páginas en 1 factura
              </button>
            ) : selMultiple.length === 1 ? (
              <span style={s.unirHint}>Selecciona al menos 2 facturas para unir</span>
            ) : (
              <span style={s.unirHint}>Cmd+clic (Mac) o Ctrl+clic (Win) para marcar y unir páginas</span>
            )}
          </div>

          {/* Detalle */}
          <div style={{ ...s.detalle, ...(flash ? s.detalleFlash : {}), ...(avisoEjercicio ? s.detalleAviso : {}) }}>
            {seleccionada ? (
              <>
                <div style={s.detalleHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={s.detalleTitle}>Detalle de la factura</span>
                    <span style={{ ...s.bolita, background: bolitaColor(seleccionada.ia_confianza) }} />
                    <span style={{ fontSize: '0.72rem', color: bolitaColor(seleccionada.ia_confianza), fontWeight: 600 }}>
                      Confianza {seleccionada.ia_confianza}
                    </span>
                    {avisoEjercicio && (
                      <span style={s.avisoEjChip}>⚠ {avisoEjercicio}</span>
                    )}
                  </div>
                </div>

                <div style={s.detalleScroll}>
                  <div style={s.grid3}>
                    <F label="Nº Factura"  value={seleccionada.num_factura}  onChange={v => editarCampo('num_factura', v)} mono />
                    <F label="Expedidor"   value={seleccionada.expedidor}     onChange={v => editarCampo('expedidor', v)} />
                    <F label="NIF / CIF"   value={seleccionada.nif_expedidor} onChange={v => editarCampo('nif_expedidor', v)} mono />
                  </div>
                  <div style={s.grid3}>
                    <FFecha label="Fecha expedicion" value={seleccionada.fecha_expedicion} onChange={v => editarCampo('fecha_expedicion', v)} />
                    <FFecha label="Fecha operacion"  value={seleccionada.fecha_operacion}  onChange={v => editarCampo('fecha_operacion', v)} />
                    <F label="Concepto"         value={seleccionada.concepto}         onChange={v => editarCampo('concepto', v)} />
                  </div>

                  <div style={s.divider} />

                  <div style={s.grid4}>
                    <F label="Base Imp." value={seleccionada.base_imponible} onChange={v => editarCampo('base_imponible', v)} right />
                    <SelectorIva label="% IVA" value={seleccionada.pct_iva} onChange={v => editarCampo('pct_iva', v)} />
                    <F label="Cuota IVA" value={seleccionada.cuota_iva}      onChange={v => editarCampo('cuota_iva', v)} right />
                    <F label="Deducible" value={seleccionada.deducible}      onChange={v => editarCampo('deducible', v)} right />
                  </div>

                  {(seleccionada.lineas_extra || []).map((linea, idx) => (
                    <div key={idx} style={s.lineaBox}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '7px' }}>
                        <span style={s.lineaTag}>Código {linea.codigo || '—'} · IVA {linea.pct_iva}%</span>
                        <button onClick={() => eliminarLineaExtra(idx)} style={s.btnElimLinea} title="Eliminar línea">✕</button>
                      </div>
                      <div style={s.grid4}>
                        <F label="Base"      value={linea.base_imponible} onChange={v => editarLineaExtra(idx, 'base_imponible', v)} right />
                        <F label="% IVA"     value={linea.pct_iva}        onChange={v => editarLineaExtra(idx, 'pct_iva', v)} right />
                        <F label="Cuota"     value={linea.cuota_iva}      onChange={v => editarLineaExtra(idx, 'cuota_iva', v)} right />
                        <F label="Deducible" value={linea.deducible}      onChange={v => editarLineaExtra(idx, 'deducible', v)} right />
                      </div>
                    </div>
                  ))}

                  <AgregarIva onAgregar={agregarLineaIva} />

                  <div style={s.totalBox}>
                    <span style={s.totalLabel}>Total factura</span>
                    <span style={s.totalValor}>{totalFactura.toFixed(2)} €</span>
                  </div>

                  {seleccionada.ia_raw?.notas && (
                    <div style={s.notasBox}>⚠ {seleccionada.ia_raw.notas}</div>
                  )}

                  {avisoEjercicio && (
                    <div style={s.avisoEjBox}>📅 {avisoEjercicio} — verificar si corresponde cargar en este periodo</div>
                  )}

                  <div style={s.botonesBox}>
                    <button onClick={descartarFactura} disabled={guardando} style={s.btnDesc}>🗑 Descartar</button>
                    <button onClick={validarFactura}   disabled={guardando} style={s.btnVal}>
                      {guardando ? '…' : '✓ Revisada'}
                    </button>
                  </div>

                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9B9B9B', fontSize: '0.85rem' }}>
                Selecciona una factura de la lista
              </div>
            )}
          </div>

        </div>

        {/* DERECHA — PDF con zoom */}
        <div style={s.rightPane}>
          <PdfViewer url={pdfUrl} />
        </div>

      </div>
    </div>
  )
}

function AgregarIva({ onAgregar }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div style={{ position: 'relative', marginBottom: '4px' }}>
      <button onClick={() => setAbierto(v => !v)} style={s.btnAgregarIva}>
        + Agregar línea de IVA
      </button>
      {abierto && (
        <div style={s.ivaDropdown}>
          {CODIGOS_IVA.map(c => (
            <div key={c.codigo}
              onClick={() => { onAgregar(c); setAbierto(false) }}
              style={s.ivaOpcion}>
              <span style={s.ivaCodigo}>{c.codigo}</span>
              <span style={s.ivaLabel}>{c.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function F({ label, value, onChange, mono, right }) {
  return (
    <div style={s.fg}>
      <label style={s.lbl}>{label}</label>
      <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
        style={{ ...s.inp, ...(mono ? { fontFamily: 'monospace' } : {}), ...(right ? { textAlign: 'right' } : {}) }} />
    </div>
  )
}

// Selector de % IVA por click — mismos valores que CODIGOS_IVA, sin tener que tipear
function SelectorIva({ label, value, onChange }) {
  const [abierto, setAbierto] = useState(false)
  const actual = CODIGOS_IVA.find(c => c.pct === value?.toString()) || null
  return (
    <div style={{ ...s.fg, position: 'relative' }}>
      <label style={s.lbl}>{label}</label>
      <button type="button" onClick={() => setAbierto(v => !v)}
        style={{ ...s.inp, textAlign: 'right', cursor: 'pointer', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{actual ? actual.label : (value || '—')}</span>
        <span style={{ fontSize: '0.65rem', color: '#9B9B9B' }}>▾</span>
      </button>
      {abierto && (
        <div style={{ ...s.ivaDropdown, right: 0, left: 'auto', width: '100%', minWidth: '160px' }}>
          {CODIGOS_IVA.map(c => (
            <div key={c.codigo + c.pct}
              onClick={() => { onChange(c.pct); setAbierto(false) }}
              style={s.ivaOpcion}>
              <span style={s.ivaCodigo}>{c.codigo}</span>
              <span style={s.ivaLabel}>{c.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Muestra la fecha como DD/MM/AAAA. Guarda el valor exactamente igual que el campo F original
// (mismo formato interno, mismo onChange) — solo cambia cómo se ve en pantalla.
function FFecha({ label, value, onChange }) {
  // value llega en formato ISO (AAAA-MM-DD) desde la base de datos
  const aDisplay = (iso) => {
    if (!iso) return ''
    const partes = iso.toString().split('-')
    if (partes.length !== 3) return iso // ya viene en otro formato, lo mostramos tal cual
    const [y, m, d] = partes
    return `${d}/${m}/${y}`
  }
  const aISO = (display) => {
    if (!display) return ''
    const partes = display.split('/')
    if (partes.length !== 3) return display // el usuario puede estar escribiendo, no forzamos formato a mitad de tipeo
    const [d, m, y] = partes
    if (d.length === 2 && m.length === 2 && y.length === 4) {
      return `${y}-${m}-${d}`
    }
    return display
  }
  return (
    <div style={s.fg}>
      <label style={s.lbl}>{label}</label>
      <input type="text" value={aDisplay(value)} placeholder="DD/MM/AAAA"
        onChange={e => onChange(aISO(e.target.value))}
        style={s.inp} />
    </div>
  )
}

const NAV_H = 56

const s = {
  shell:      { position: 'fixed', top: NAV_H + 'px', left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: '#E8E6E0', zIndex: 50 },
  topBar:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', background: '#1A472A', color: '#fff', flexShrink: 0 },
  topTitle:   { fontSize: '0.88rem', fontWeight: 700 },
  topMeta:    { fontSize: '0.75rem', color: '#B5D6C0' },
  btnCerrar:  { background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  btnVolverTop: { background: 'none', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: '5px', padding: '4px 10px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  btnVolver:  { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '7px', padding: '10px 22px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' },
  progWrap:   { width: '110px', height: '5px', background: 'rgba(255,255,255,0.2)', borderRadius: '3px', overflow: 'hidden' },
  progBar:    { height: '100%', background: '#7ED957', borderRadius: '3px', transition: 'width 0.4s ease' },

  body:       { flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 },
  leftPane:   { display: 'flex', flexDirection: 'column', borderRight: '3px solid #C8C4BC', minHeight: 0 },

  listaBox:   { flex: '0 0 40%', overflowX: 'auto', overflowY: 'auto', background: '#fff', borderBottom: '2px solid #C8C4BC' },
  tabla:      { borderCollapse: 'collapse', fontSize: '0.83rem', tableLayout: 'fixed' },
  th:         { position: 'sticky', top: 0, padding: '7px 10px', textAlign: 'left', fontSize: '0.67rem', fontWeight: 700, color: '#5A5A5A', textTransform: 'uppercase', letterSpacing: '0.4px', background: '#DEDAD3', borderBottom: '1px solid #C8C4BC', borderRight: '1px solid #C8C4BC', zIndex: 1, userSelect: 'none' },
  resizer:    { position: 'absolute', top: 0, right: 0, width: '6px', height: '100%', cursor: 'col-resize', zIndex: 10, background: 'transparent' },
  tr:         { cursor: 'pointer', borderBottom: '1px solid #EDEAE3' },
  trSel:      { background: '#C9E8F5' },
  trAviso:    { background: '#FFF3E0' },
  td:         { padding: '7px 10px', color: '#1C1C1C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderRight: '1px solid #EDEAE3' },
  bolita:     { display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', verticalAlign: 'middle' },

  detalle:        { flex: 1, display: 'flex', flexDirection: 'column', background: '#F5F3EE', minHeight: 0, transition: 'box-shadow 0.3s' },
  detalleFlash:   { boxShadow: 'inset 0 0 0 3px #7ED957' },
  detalleAviso:   { borderTop: '3px solid #F5A623' },
  detalleHeader:  { display: 'flex', alignItems: 'center', padding: '8px 14px', background: '#DEDAD3', borderBottom: '1px solid #C8C4BC', flexShrink: 0 },
  detalleTitle:   { fontSize: '0.8rem', fontWeight: 700, marginRight: '4px' },
  detalleScroll:  { flex: 1, overflowY: 'auto', padding: '12px 14px' },

  avisoEjChip: { background: '#FFF3E0', color: '#C05000', border: '1px solid #FFB74D', borderRadius: '10px', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600 },
  avisoEjBox:  { background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: '5px', padding: '7px 10px', fontSize: '0.75rem', color: '#C05000', marginTop: '10px' },

  botonesBox:  { display: 'flex', gap: '8px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #D8D4CB' },
  btnVal:      { flex: 2, background: '#1A472A', color: '#fff', border: 'none', borderRadius: '5px', padding: '10px 14px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' },
  btnDesc:     { flex: 1, background: '#fff', color: '#E2401B', border: '1px solid #FFCC80', borderRadius: '5px', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' },

  rightPane:   { display: 'flex', flexDirection: 'column', background: '#2A2A2A', minHeight: 0 },

  btnAgregarIva: { background: '#E8F0FE', color: '#1565C0', border: '1px dashed #90CAF9', borderRadius: '5px', padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', width: '100%', marginBottom: '10px' },
  ivaDropdown:   { position: 'absolute', top: '100%', left: 0, background: '#fff', border: '1px solid #D8D4CB', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 20, minWidth: '200px' },
  ivaOpcion:     { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #EDEAE3' },
  ivaCodigo:     { background: '#1A472A', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '0.8rem', fontWeight: 700, minWidth: '22px', textAlign: 'center' },
  ivaLabel:      { fontSize: '0.82rem', color: '#1C1C1C' },
  btnElimLinea:  { background: 'transparent', border: 'none', color: '#E2401B', cursor: 'pointer', fontSize: '0.8rem', padding: '0 4px', fontWeight: 700 },

  fg:      { marginBottom: '8px' },
  lbl:     { display: 'block', fontSize: '0.65rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '3px' },
  inp:     { width: '100%', padding: '6px 8px', border: '1px solid #D8D4CB', borderRadius: '5px', fontSize: '0.84rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' },
  divider: { borderTop: '1px solid #D8D4CB', margin: '10px 0' },
  grid3:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' },
  grid4:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '7px' },
  totalBox:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#E3F0E8', borderRadius: '5px', padding: '9px 12px', marginTop: '10px' },
  totalLabel:  { fontSize: '0.76rem', fontWeight: 600, color: '#1A472A' },
  totalValor:  { fontSize: '1.1rem', fontWeight: 700, color: '#1A472A' },
  lineaBox:    { background: '#EDEAE3', borderRadius: '5px', padding: '9px', marginBottom: '8px' },
  lineaTag:    { display: 'inline-block', background: '#1A472A', color: '#fff', borderRadius: '3px', padding: '1px 7px', fontSize: '0.65rem', fontWeight: 700 },
  notasBox:    { background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '5px', padding: '7px 10px', fontSize: '0.75rem', color: '#B8860B', marginTop: '10px' },

  badgeProcesada: { display: 'inline-block', padding: '2px 7px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, background: '#E3F0E8', color: '#1A472A', textTransform: 'capitalize' },
  badgeRevisar:   { display: 'inline-block', padding: '2px 7px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, background: '#FFF3E0', color: '#B8860B', textTransform: 'capitalize' },
  badgePendiente: { display: 'inline-block', padding: '2px 7px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, background: '#ECECEC', color: '#6B6B6B', textTransform: 'capitalize' },
  motivoTexto:    { fontSize: '0.6rem', color: '#B8860B', marginTop: '2px', lineHeight: 1.2, whiteSpace: 'normal', maxWidth: '100%' },

  trMarcada:    { background: '#E3F2FD', borderLeft: '3px solid #1565C0' },
  marcadaBadge: { marginLeft: '4px', fontSize: '0.6rem', background: '#1565C0', color: '#fff', borderRadius: '4px', padding: '1px 5px', fontWeight: 700 },
  paginaAviso:  { fontSize: '0.68rem', color: '#E65100', background: '#FFF3E0', borderRadius: '4px', padding: '2px 6px', display: 'inline-block' },
  unirBar:      { flexShrink: 0, padding: '5px 12px', background: '#F5F3EE', borderBottom: '1px solid #D8D4CB', textAlign: 'center' },
  btnUnir:      { background: '#1565C0', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', width: '100%' },
  unirHint:     { fontSize: '0.7rem', color: '#6B6B6B' },

}