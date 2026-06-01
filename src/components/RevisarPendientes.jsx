import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function RevisarPendientes({ clienteId, onCerrar, onValidada }) {
  const [facturas,     setFacturas]     = useState([])
  const [seleccionId,  setSeleccionId]  = useState(null)
  const [guardando,    setGuardando]    = useState(false)
  const [pdfUrl,       setPdfUrl]       = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [revisadas,    setRevisadas]    = useState(0)
  const [totalInicial, setTotalInicial] = useState(0)
  const [flash,        setFlash]        = useState(false)

  const seleccionada = facturas.find(f => f.id === seleccionId) || null

  useEffect(() => { fetchPendientes() }, [clienteId])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    if (seleccionada?.archivo_url) cargarPdf(seleccionada.archivo_url)
    else setPdfUrl(null)
  }, [seleccionId])

  async function fetchPendientes() {
    setLoading(true)
    const { data } = await supabase
      .from('facturas').select('*')
      .eq('cliente_id', clienteId).eq('estado', 'pendiente')
      .order('created_at', { ascending: false })
    const list = data ?? []
    setFacturas(list)
    setTotalInicial(list.length)
    if (list.length > 0) setSeleccionId(list[0].id)
    setLoading(false)
  }

  function cargarPdf(archivo_url) {
    setPdfUrl(null)
    try {
      const { data } = supabase.storage.from('facturas').getPublicUrl(archivo_url)
      if (data?.publicUrl) setPdfUrl(data.publicUrl)
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
      setRevisadas(r => r + 1)
      setFlash(true)
      setTimeout(() => setFlash(false), 500)
      const restantes = facturas.filter(x => x.id !== f.id)
      setFacturas(restantes)
      onValidada?.()
      if (restantes.length > 0) setSeleccionId(restantes[0].id)
      else { onCerrar?.() }
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
    + (seleccionada.lineas_extra || []).reduce((s, l) => s + (parseFloat(l.base_imponible) || 0) + (parseFloat(l.cuota_iva) || 0), 0)
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

      {/* ── BARRA SUPERIOR ── */}
      <div style={s.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={s.topTitle}>Identificación de facturas</span>
          <span style={s.topMeta}>{facturas.length} pendiente{facturas.length !== 1 ? 's' : ''}{revisadas > 0 ? ' · ' + revisadas + ' revisada' + (revisadas !== 1 ? 's' : '') : ''}</span>
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

      {/* ── CUERPO PRINCIPAL: izquierda (lista + detalle) | derecha (PDF) ── */}
      <div style={s.body}>

        {/* IZQUIERDA */}
        <div style={s.leftPane}>

          {/* Lista de facturas — tabla A3 */}
          <div style={s.listaBox}>
            <table style={s.tabla}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: '36px', textAlign: 'center' }}>Estado</th>
                  <th style={s.th}>Empresa / Expedidor</th>
                  <th style={{ ...s.th, width: '88px' }}>Fecha</th>
                  <th style={{ ...s.th, width: '120px' }}>Nº Factura</th>
                  <th style={{ ...s.th, width: '95px', textAlign: 'right' }}>Total</th>
                  <th style={{ ...s.th, width: '80px' }}>Tipo</th>
                  <th style={{ ...s.th, width: '80px' }}>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map(f => {
                  const isSel   = f.id === seleccionId
                  const total   = (parseFloat(f.base_imponible) || 0) + (parseFloat(f.cuota_iva) || 0)
                  const esAbono = f.tipo === 'abono' || total < 0
                  const tieneNota = f.ia_raw?.notas || ''
                  return (
                    <tr key={f.id} onClick={() => setSeleccionId(f.id)}
                      style={{ ...s.tr, ...(isSel ? s.trSel : {}) }}>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        <span style={{ ...s.bolita, background: bolitaColor(f.ia_confianza) }} />
                      </td>
                      <td style={{ ...s.td, fontWeight: isSel ? 700 : 400 }}>{f.expedidor || '—'}</td>
                      <td style={s.td}>{f.fecha_expedicion ? new Date(f.fecha_expedicion).toLocaleDateString('es-ES') : '—'}</td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.77rem' }}>{f.num_factura || '—'}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: esAbono ? '#E2401B' : '#1C1C1C', fontWeight: 600 }}>{total.toFixed(2)}</td>
                      <td style={s.td}>{esAbono ? 'Abono' : 'Recibida'}</td>
                      <td style={{ ...s.td, fontSize: '0.72rem', color: '#E2401B' }}>{tieneNota ? '⚠' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Detalle editable */}
          <div style={{ ...s.detalle, ...(flash ? s.detalleFlash : {}) }}>
            {seleccionada ? (
              <>
                <div style={s.detalleHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={s.detalleTitle}>Detalle de la factura</span>
                    <span style={{ ...s.bolita, background: bolitaColor(seleccionada.ia_confianza) }} />
                    <span style={{ fontSize: '0.72rem', color: bolitaColor(seleccionada.ia_confianza), fontWeight: 600 }}>IA {seleccionada.ia_confianza}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={descartarFactura} disabled={guardando} style={s.btnDesc}>🗑 Descartar</button>
                    <button onClick={validarFactura}   disabled={guardando} style={s.btnVal}>
                      {guardando ? '…' : '✓ Revisada · Interpretar'}
                    </button>
                  </div>
                </div>

                <div style={s.detalleScroll}>
                  <div style={s.grid3}>
                    <F label="Nº Factura"  value={seleccionada.num_factura}  onChange={v => editarCampo('num_factura', v)} mono />
                    <F label="Expedidor"   value={seleccionada.expedidor}     onChange={v => editarCampo('expedidor', v)} />
                    <F label="NIF / CIF"   value={seleccionada.nif_expedidor} onChange={v => editarCampo('nif_expedidor', v)} mono />
                  </div>
                  <div style={s.grid3}>
                    <F label="Fecha expedicion" value={seleccionada.fecha_expedicion} onChange={v => editarCampo('fecha_expedicion', v)} />
                    <F label="Fecha operacion"  value={seleccionada.fecha_operacion}  onChange={v => editarCampo('fecha_operacion', v)} />
                    <F label="Concepto"         value={seleccionada.concepto}         onChange={v => editarCampo('concepto', v)} />
                  </div>

                  <div style={s.divider} />

                  <div style={s.grid4}>
                    <F label="Base Imp." value={seleccionada.base_imponible} onChange={v => editarCampo('base_imponible', v)} right />
                    <F label="% IVA"     value={seleccionada.pct_iva}        onChange={v => editarCampo('pct_iva', v)} right />
                    <F label="Cuota IVA" value={seleccionada.cuota_iva}      onChange={v => editarCampo('cuota_iva', v)} right />
                    <F label="Deducible" value={seleccionada.deducible}      onChange={v => editarCampo('deducible', v)} right />
                  </div>

                  {(seleccionada.lineas_extra || []).map((linea, idx) => (
                    <div key={idx} style={s.lineaBox}>
                      <span style={s.lineaTag}>IVA {linea.pct_iva}%</span>
                      <div style={s.grid4}>
                        <F label="Base"      value={linea.base_imponible} onChange={v => editarLineaExtra(idx, 'base_imponible', v)} right />
                        <F label="% IVA"     value={linea.pct_iva}        onChange={v => editarLineaExtra(idx, 'pct_iva', v)} right />
                        <F label="Cuota"     value={linea.cuota_iva}      onChange={v => editarLineaExtra(idx, 'cuota_iva', v)} right />
                        <F label="Deducible" value={linea.deducible}      onChange={v => editarLineaExtra(idx, 'deducible', v)} right />
                      </div>
                    </div>
                  ))}

                  <div style={s.totalBox}>
                    <span style={s.totalLabel}>Total factura</span>
                    <span style={s.totalValor}>{totalFactura.toFixed(2)} €</span>
                  </div>

                  {seleccionada.ia_raw?.notas && (
                    <div style={s.notasBox}>⚠ {seleccionada.ia_raw.notas}</div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9B9B9B', fontSize: '0.85rem' }}>
                Selecciona una factura de la lista
              </div>
            )}
          </div>

        </div>

        {/* DERECHA — PDF full height */}
        <div style={s.rightPane}>
          <div style={s.pdfHeader}>📄 Documento original</div>
          {pdfUrl ? (
            <iframe src={pdfUrl + '#toolbar=0&navpanes=0&view=FitH'} style={s.pdfFrame} title="Documento original" />
          ) : (
            <div style={s.pdfEmpty}>
              <div style={{ fontSize: '2.5rem', opacity: 0.25, marginBottom: '8px' }}>📄</div>
              <span style={{ fontSize: '0.82rem' }}>Sin documento adjunto</span>
            </div>
          )}
        </div>

      </div>
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

const NAV_H = 56

const s = {
  shell:      { position: 'fixed', top: NAV_H + 'px', left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: '#E8E6E0', zIndex: 50 },

  topBar:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', background: '#1A472A', color: '#fff', flexShrink: 0 },
  topTitle:   { fontSize: '0.88rem', fontWeight: 700 },
  topMeta:    { fontSize: '0.75rem', color: '#B5D6C0' },
  btnCerrar:  { background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  btnVolver:  { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '7px', padding: '10px 22px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' },
  progWrap:   { width: '110px', height: '5px', background: 'rgba(255,255,255,0.2)', borderRadius: '3px', overflow: 'hidden' },
  progBar:    { height: '100%', background: '#7ED957', borderRadius: '3px', transition: 'width 0.4s ease' },

  body:       { flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 },

  // IZQUIERDA
  leftPane:   { display: 'flex', flexDirection: 'column', borderRight: '3px solid #C8C4BC', minHeight: 0 },

  listaBox:   { flex: '0 0 42%', overflowY: 'auto', background: '#fff', borderBottom: '2px solid #C8C4BC' },
  tabla:      { width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' },
  th:         { position: 'sticky', top: 0, padding: '7px 10px', textAlign: 'left', fontSize: '0.67rem', fontWeight: 700, color: '#5A5A5A', textTransform: 'uppercase', letterSpacing: '0.4px', background: '#DEDAD3', borderBottom: '1px solid #C8C4BC', zIndex: 1 },
  tr:         { cursor: 'pointer', borderBottom: '1px solid #EDEAE3' },
  trSel:      { background: '#C9E8F5' },
  td:         { padding: '7px 10px', color: '#1C1C1C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' },
  bolita:     { display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', verticalAlign: 'middle' },

  detalle:        { flex: 1, display: 'flex', flexDirection: 'column', background: '#F5F3EE', minHeight: 0, transition: 'box-shadow 0.3s' },
  detalleFlash:   { boxShadow: 'inset 0 0 0 3px #7ED957' },
  detalleHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: '#DEDAD3', borderBottom: '1px solid #C8C4BC', flexShrink: 0 },
  detalleTitle:   { fontSize: '0.8rem', fontWeight: 700 },
  detalleScroll:  { flex: 1, overflowY: 'auto', padding: '12px 14px' },

  btnVal:     { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '5px', padding: '7px 14px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' },
  btnDesc:    { background: '#fff', color: '#E2401B', border: '1px solid #FFCC80', borderRadius: '5px', padding: '7px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },

  // DERECHA
  rightPane:  { display: 'flex', flexDirection: 'column', background: '#2A2A2A', minHeight: 0 },
  pdfHeader:  { padding: '7px 14px', background: '#3A3A3A', color: '#ccc', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0, borderBottom: '1px solid #555' },
  pdfFrame:   { flex: 1, width: '100%', border: 'none', display: 'block' },
  pdfEmpty:   { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#666' },

  fg:     { marginBottom: '8px' },
  lbl:    { display: 'block', fontSize: '0.65rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '3px' },
  inp:    { width: '100%', padding: '6px 8px', border: '1px solid #D8D4CB', borderRadius: '5px', fontSize: '0.84rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' },
  divider:{ borderTop: '1px solid #D8D4CB', margin: '10px 0' },
  grid3:  { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' },
  grid4:  { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '7px' },
  totalBox:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#E3F0E8', borderRadius: '5px', padding: '9px 12px', marginTop: '10px' },
  totalLabel: { fontSize: '0.76rem', fontWeight: 600, color: '#1A472A' },
  totalValor: { fontSize: '1.1rem', fontWeight: 700, color: '#1A472A' },
  lineaBox:   { background: '#EDEAE3', borderRadius: '5px', padding: '9px', marginBottom: '8px' },
  lineaTag:   { display: 'inline-block', background: '#1A472A', color: '#fff', borderRadius: '3px', padding: '1px 7px', fontSize: '0.65rem', fontWeight: 700, marginBottom: '7px' },
  notasBox:   { background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '5px', padding: '7px 10px', fontSize: '0.75rem', color: '#B8860B', marginTop: '10px' },
}
