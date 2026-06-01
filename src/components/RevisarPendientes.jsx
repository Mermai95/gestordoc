import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function RevisarPendientes({ clienteId, onCerrar, onValidada }) {
  const [facturas,     setFacturas]     = useState([])
  const [seleccionId,  setSeleccionId]  = useState(null)
  const [guardando,    setGuardando]    = useState(false)
  const [pdfUrl,       setPdfUrl]       = useState(null)
  const [loadingPdf,   setLoadingPdf]   = useState(false)
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
      .from('facturas')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: false })
    const list = data ?? []
    setFacturas(list)
    setTotalInicial(list.length)
    if (list.length > 0) setSeleccionId(list[0].id)
    setLoading(false)
  }

  function cargarPdf(archivo_url) {
    setLoadingPdf(true)
    setPdfUrl(null)
    try {
      const { data } = supabase.storage.from('facturas').getPublicUrl(archivo_url)
      if (data?.publicUrl) setPdfUrl(data.publicUrl)
    } catch (err) {
      console.error('Error cargando PDF:', err)
    }
    setLoadingPdf(false)
  }

  function editarCampo(campo, valor) {
    setFacturas(fs => fs.map(f => {
      if (f.id !== seleccionId) return f
      const updated = { ...f, [campo]: valor }
      if (campo === 'base_imponible' || campo === 'pct_iva') {
        const base = parseFloat(campo === 'base_imponible' ? valor : f.base_imponible) || 0
        const pct  = parseFloat((campo === 'pct_iva' ? valor : f.pct_iva)?.toString().replace(',', '.')) || 0
        const cuota = Math.round(base * pct / 100 * 100) / 100
        updated.cuota_iva = cuota.toFixed(2)
        updated.deducible = cuota.toFixed(2)
      }
      return updated
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
    const { error } = await supabase
      .from('facturas')
      .update({
        estado:           'validada',
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
      })
      .eq('id', f.id)

    if (!error) {
      setRevisadas(r => r + 1)
      setFlash(true)
      setTimeout(() => setFlash(false), 600)
      const restantes = facturas.filter(x => x.id !== f.id)
      setFacturas(restantes)
      onValidada?.()
      if (restantes.length > 0) setSeleccionId(restantes[0].id)
      else { onValidada?.(); onCerrar?.() }
    } else {
      console.error('Error validando:', error)
    }
    setGuardando(false)
  }

  async function descartarFactura() {
    if (!seleccionada || guardando) return
    setGuardando(true)
    const { error } = await supabase
      .from('facturas')
      .update({ estado: 'error' })
      .eq('id', seleccionada.id)
    if (!error) {
      const restantes = facturas.filter(x => x.id !== seleccionada.id)
      setFacturas(restantes)
      if (restantes.length > 0) setSeleccionId(restantes[0].id)
      else onCerrar?.()
    }
    setGuardando(false)
  }

  const totalBase = seleccionada
    ? (parseFloat(seleccionada.base_imponible) || 0) +
      (seleccionada.lineas_extra || []).reduce((s, l) => s + (parseFloat(l.base_imponible) || 0), 0)
    : 0
  const totalCuota = seleccionada
    ? (parseFloat(seleccionada.cuota_iva) || 0) +
      (seleccionada.lineas_extra || []).reduce((s, l) => s + (parseFloat(l.cuota_iva) || 0), 0)
    : 0
  const totalFactura = totalBase + totalCuota

  const bolitaColor = conf => ({ alta: '#22A722', media: '#F5A623', baja: '#E2401B' }[conf] || '#9B9B9B')

  if (loading) {
    return (
      <div style={{ ...s.appShell, alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9B9B9B' }}>Cargando pendientes…</p>
      </div>
    )
  }

  if (facturas.length === 0) {
    return (
      <div style={{ ...s.appShell, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: '3rem' }}>✓</div>
        <p style={{ color: '#22A722', fontWeight: 700, fontSize: '1.15rem' }}>Bandeja limpia</p>
        {revisadas > 0 && (
          <p style={{ color: '#6B6B6B', fontSize: '0.9rem' }}>
            Revisaste {revisadas} factura{revisadas !== 1 ? 's' : ''} en esta sesión 🔥
          </p>
        )}
        <button onClick={onCerrar} style={s.btnVolver}>Volver</button>
      </div>
    )
  }

  const progreso = totalInicial > 0 ? Math.round((revisadas / totalInicial) * 100) : 0

  return (
    <div style={s.appShell}>

      <div style={s.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={s.topTitle}>Identificación de facturas</span>
          <span style={s.topMeta}>
            {facturas.length} pendiente{facturas.length !== 1 ? 's' : ''}
            {revisadas > 0 ? ' · ' + revisadas + ' revisada' + (revisadas !== 1 ? 's' : '') : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {totalInicial > 1 && (
            <div style={s.progressWrap} title={progreso + '% completado'}>
              <div style={{ ...s.progressBar, width: progreso + '%' }} />
            </div>
          )}
          <button onClick={onCerrar} style={s.topClose}>✕ Cerrar</button>
        </div>
      </div>

      <div style={s.listaWrap}>
        <table style={s.tabla}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: '40px', textAlign: 'center' }}>Estado</th>
              <th style={s.th}>Expedidor</th>
              <th style={{ ...s.th, width: '90px' }}>Fecha</th>
              <th style={{ ...s.th, width: '130px' }}>Nº Factura</th>
              <th style={{ ...s.th, width: '100px', textAlign: 'right' }}>Total</th>
              <th style={{ ...s.th, width: '90px' }}>Tipo</th>
              <th style={{ ...s.th, width: '50px', textAlign: 'center' }}>IA</th>
            </tr>
          </thead>
          <tbody>
            {facturas.map(f => {
              const isSel = f.id === seleccionId
              const total = (parseFloat(f.base_imponible) || 0) + (parseFloat(f.cuota_iva) || 0)
              const esAbono = f.tipo === 'abono' || total < 0
              return (
                <tr
                  key={f.id}
                  onClick={() => setSeleccionId(f.id)}
                  style={{ ...s.tr, ...(isSel ? s.trSel : {}) }}
                >
                  <td style={{ ...s.td, textAlign: 'center' }}>
                    <span style={{ ...s.bolita, background: bolitaColor(f.ia_confianza) }} />
                  </td>
                  <td style={{ ...s.td, fontWeight: isSel ? 700 : 500 }}>{f.expedidor || '—'}</td>
                  <td style={s.td}>{f.fecha_expedicion ? new Date(f.fecha_expedicion).toLocaleDateString('es-ES') : '—'}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{f.num_factura || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontWeight: 600, color: esAbono ? '#E2401B' : '#1C1C1C' }}>
                    {total.toFixed(2)} €
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.tipoBadge, ...(esAbono ? s.tipoAbono : s.tipoRecibida) }}>
                      {esAbono ? 'Abono' : 'Recibida'}
                    </span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'center', fontSize: '0.7rem', color: bolitaColor(f.ia_confianza), fontWeight: 700 }}>
                    {f.ia_confianza || '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={s.bottomZone}>

        <div style={{ ...s.detailCol, ...(flash ? s.detailFlash : {}) }}>
          {seleccionada && (
            <>
              <div style={s.detailHeader}>
                <span style={s.detailTitle}>Detalle de la factura</span>
                <span style={{ ...s.confChip, color: bolitaColor(seleccionada.ia_confianza), borderColor: bolitaColor(seleccionada.ia_confianza) }}>
                  <span style={{ ...s.bolita, background: bolitaColor(seleccionada.ia_confianza), marginRight: '5px' }} />
                  IA {seleccionada.ia_confianza || '—'}
                </span>
              </div>

              <div style={s.detailScroll}>
                <F label="Nº Factura"  value={seleccionada.num_factura}  onChange={v => editarCampo('num_factura', v)} mono />
                <F label="Expedidor"   value={seleccionada.expedidor}     onChange={v => editarCampo('expedidor', v)} />
                <F label="NIF / CIF"   value={seleccionada.nif_expedidor} onChange={v => editarCampo('nif_expedidor', v)} mono />
                <F label="Concepto"    value={seleccionada.concepto}      onChange={v => editarCampo('concepto', v)} />

                <div style={s.grid2}>
                  <F label="Fecha expedicion" value={seleccionada.fecha_expedicion} onChange={v => editarCampo('fecha_expedicion', v)} />
                  <F label="Fecha operacion"  value={seleccionada.fecha_operacion}  onChange={v => editarCampo('fecha_operacion', v)} />
                </div>

                <div style={s.divider} />

                <div style={s.grid4}>
                  <F label="Base Imp." value={seleccionada.base_imponible} onChange={v => editarCampo('base_imponible', v)} right />
                  <F label="% IVA"     value={seleccionada.pct_iva}        onChange={v => editarCampo('pct_iva', v)} right />
                  <F label="Cuota"     value={seleccionada.cuota_iva}      onChange={v => editarCampo('cuota_iva', v)} right />
                  <F label="Deducible" value={seleccionada.deducible}      onChange={v => editarCampo('deducible', v)} right />
                </div>

                {(seleccionada.lineas_extra || []).length > 0 && (
                  <div style={{ marginTop: '10px' }}>
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
                  </div>
                )}

                <div style={s.totalBox}>
                  <span style={s.totalLabel}>Total factura</span>
                  <span style={s.totalValor}>{totalFactura.toFixed(2)} €</span>
                </div>

                {seleccionada.ia_raw?.notas && (
                  <div style={s.notasBox}>⚠ {seleccionada.ia_raw.notas}</div>
                )}
              </div>

              <div style={s.detailFooter}>
                <button onClick={descartarFactura} disabled={guardando} style={s.btnDescartar}>
                  🗑 Descartar
                </button>
                <button onClick={validarFactura} disabled={guardando} style={s.btnValidar}>
                  {guardando ? '…' : '✓ Validar e interpretar'}
                </button>
              </div>
            </>
          )}
        </div>

        <div style={s.pdfCol}>
          {loadingPdf ? (
            <div style={s.pdfEmpty}><span style={{ fontSize: '1.4rem' }}>⟳</span><span>Cargando documento…</span></div>
          ) : pdfUrl ? (
            <iframe src={pdfUrl + '#toolbar=0&navpanes=0&view=FitH'} style={s.pdfFrame} title="Documento original" />
          ) : (
            <div style={s.pdfEmpty}>
              <div style={{ fontSize: '2.2rem', opacity: 0.3, marginBottom: '6px' }}>📄</div>
              <span>Documento no disponible</span>
              <span style={{ fontSize: '0.72rem', color: '#777', marginTop: '4px' }}>Procesada sin archivo adjunto</span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function F({ label, value, onChange, mono, right }) {
  return (
    <div style={s.fieldGroup}>
      <label style={s.label}>{label}</label>
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{ ...s.input, ...(mono ? { fontFamily: 'monospace' } : {}), ...(right ? { textAlign: 'right' } : {}) }}
      />
    </div>
  )
}

const NAV_H = 56

const s = {
  appShell:   { position: 'fixed', top: NAV_H + 'px', left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: '#E8E6E0', zIndex: 50 },

  topBar:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#1A472A', color: '#fff', flexShrink: 0 },
  topTitle:   { fontSize: '0.9rem', fontWeight: 700 },
  topMeta:    { fontSize: '0.78rem', color: '#B5D6C0' },
  topClose:   { background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  progressWrap:{ width: '120px', height: '6px', background: 'rgba(255,255,255,0.2)', borderRadius: '3px', overflow: 'hidden' },
  progressBar: { height: '100%', background: '#7ED957', borderRadius: '3px', transition: 'width 0.4s ease' },

  listaWrap:  { flex: '0 0 38%', overflowY: 'auto', background: '#fff', margin: '8px 8px 4px', borderRadius: '8px', border: '1px solid #D8D4CB' },
  tabla:      { width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' },
  th:         { position: 'sticky', top: 0, padding: '8px 12px', textAlign: 'left', fontSize: '0.68rem', fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.5px', background: '#F5F3EE', borderBottom: '1px solid #D8D4CB', zIndex: 1 },
  tr:         { cursor: 'pointer', borderBottom: '1px solid #EDEAE3' },
  trSel:      { background: '#E3F0E8' },
  td:         { padding: '8px 12px', color: '#1C1C1C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' },
  bolita:     { display: 'inline-block', width: '11px', height: '11px', borderRadius: '50%' },
  tipoBadge:  { fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '10px' },
  tipoRecibida:{ background: '#E8F0FE', color: '#1565C0' },
  tipoAbono:  { background: '#FFF3E0', color: '#E2401B' },

  bottomZone: { flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '4px 8px 8px', minHeight: 0 },

  detailCol:  { display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '8px', border: '1px solid #D8D4CB', overflow: 'hidden', transition: 'box-shadow 0.3s' },
  detailFlash:{ boxShadow: '0 0 0 3px #7ED957' },
  detailHeader:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid #D8D4CB', background: '#fafafa', flexShrink: 0 },
  detailTitle:{ fontSize: '0.82rem', fontWeight: 700 },
  confChip:   { display: 'inline-flex', alignItems: 'center', fontSize: '0.7rem', fontWeight: 600, border: '1px solid', borderRadius: '12px', padding: '2px 9px' },
  detailScroll:{ flex: 1, overflowY: 'auto', padding: '14px' },
  detailFooter:{ display: 'flex', gap: '8px', padding: '10px 14px', borderTop: '1px solid #D8D4CB', background: '#fff', flexShrink: 0 },
  btnValidar: { flex: 2, background: '#1A472A', color: '#fff', border: 'none', borderRadius: '7px', padding: '11px', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer' },
  btnDescartar:{ flex: 1, background: '#FFF3E0', color: '#E2401B', border: '1px solid #FFCC80', borderRadius: '7px', padding: '11px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' },
  btnVolver:  { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' },

  pdfCol:     { background: '#3A3A3A', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  pdfFrame:   { width: '100%', height: '100%', border: 'none', display: 'block' },
  pdfEmpty:   { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#999', gap: '4px', fontSize: '0.85rem' },

  fieldGroup: { marginBottom: '9px' },
  label:      { display: 'block', fontSize: '0.66rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '3px' },
  input:      { width: '100%', padding: '7px 9px', border: '1px solid #D8D4CB', borderRadius: '6px', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  divider:    { borderTop: '1px solid #EDEAE3', margin: '11px 0' },
  grid2:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
  grid4:      { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '7px' },
  totalBox:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#E3F0E8', borderRadius: '6px', padding: '10px 12px', marginTop: '10px' },
  totalLabel: { fontSize: '0.78rem', fontWeight: 600, color: '#1A472A' },
  totalValor: { fontSize: '1.15rem', fontWeight: 700, color: '#1A472A' },
  lineaBox:   { background: '#F5F3EE', borderRadius: '6px', padding: '10px', marginBottom: '8px' },
  lineaTag:   { display: 'inline-block', background: '#1A472A', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '0.66rem', fontWeight: 700, marginBottom: '8px' },
  notasBox:   { background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '6px', padding: '8px 10px', fontSize: '0.76rem', color: '#B8860B', marginTop: '12px' },
}
