import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function RevisarPendientes({ clienteId, onCerrar, onValidada }) {
  const [facturas,      setFacturas]      = useState([])
  const [seleccionId,   setSeleccionId]   = useState(null)
  const [guardando,     setGuardando]     = useState(false)
  const [pdfUrl,        setPdfUrl]        = useState(null)
  const [loadingPdf,    setLoadingPdf]    = useState(false)
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    fetchPendientes()
  }, [clienteId])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    if (seleccionada?.archivo_url) {
      cargarPdf(seleccionada.archivo_url)
    } else {
      setPdfUrl(null)
    }
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
    if (list.length > 0) setSeleccionId(list[0].id)
    setLoading(false)
  }

  async function cargarPdf(archivo_url) {
    setLoadingPdf(true)
    setPdfUrl(null)
    try {
      const { data } = await supabase.storage
        .from('facturas')
        .createSignedUrl(archivo_url, 3600)
      if (data?.signedUrl) setPdfUrl(data.signedUrl)
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

  async function validarFactura() {
    if (!seleccionada || guardando) return
    setGuardando(true)

    const parseDate = str => {
      if (!str) return null
      if (str.includes('/')) {
        const [d, m, y] = str.split('/').map(Number)
        return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      }
      return str
    }

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
      const restantes = facturas.filter(x => x.id !== f.id)
      setFacturas(restantes)
      if (restantes.length > 0) {
        setSeleccionId(restantes[0].id)
      } else {
        onValidada?.()
        onCerrar?.()
      }
      onValidada?.()
    } else {
      console.error('Error validando:', error)
    }
    setGuardando(false)
  }

  async function eliminarFactura() {
    if (!seleccionada || guardando) return
    setGuardando(true)
    const { error } = await supabase
      .from('facturas')
      .update({ estado: 'error' })
      .eq('id', seleccionada.id)

    if (!error) {
      const restantes = facturas.filter(x => x.id !== seleccionada.id)
      setFacturas(restantes)
      if (restantes.length > 0) {
        setSeleccionId(restantes[0].id)
      } else {
        onCerrar?.()
      }
    }
    setGuardando(false)
  }

  const seleccionada = facturas.find(f => f.id === seleccionId) || null

  const totalBase = seleccionada
    ? (parseFloat(seleccionada.base_imponible) || 0) +
      (seleccionada.lineas_extra || []).reduce((s, l) => s + (parseFloat(l.base_imponible) || 0), 0)
    : 0

  const totalCuota = seleccionada
    ? (parseFloat(seleccionada.cuota_iva) || 0) +
      (seleccionada.lineas_extra || []).reduce((s, l) => s + (parseFloat(l.cuota_iva) || 0), 0)
    : 0

  const totalFactura = totalBase + totalCuota

  if (loading) {
    return (
      <div style={{ ...s.appShell, alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#6B6B6B' }}>Cargando pendientes…</p>
      </div>
    )
  }

  if (facturas.length === 0) {
    return (
      <div style={{ ...s.appShell, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '3rem' }}>✓</div>
        <p style={{ color: '#2E7D32', fontWeight: 700, fontSize: '1.1rem' }}>Sin pendientes — todo al día</p>
        <button onClick={onCerrar} style={s.btnCerrar}>Cerrar</button>
      </div>
    )
  }

  return (
    <div style={s.appShell}>

      {/* ── IZQUIERDA — lista ── */}
      <div style={s.leftCol}>
        <div style={s.leftHeader}>
          <span style={s.leftTitle}>Pendientes ({facturas.length})</span>
          <button onClick={onCerrar} style={s.btnCerrarX} title="Cerrar">✕</button>
        </div>
        <div style={s.leftScroll}>
          {facturas.map(f => {
            const isSel = f.id === seleccionId
            const total = (parseFloat(f.base_imponible) || 0) + (parseFloat(f.cuota_iva) || 0)
            return (
              <div
                key={f.id}
                onClick={() => setSeleccionId(f.id)}
                style={{ ...s.listaItem, ...(isSel ? s.listaItemSel : {}) }}
              >
                <div style={s.listaRowTop}>
                  <span style={s.listaNum}>{f.num_factura || '—'}</span>
                  <span style={{ fontSize: '0.68rem', color: f.ia_confianza === 'alta' ? '#2E7D32' : f.ia_confianza === 'media' ? '#F57F17' : '#E65100', fontWeight: 600 }}>
                    {f.ia_confianza === 'alta' ? '● alta' : f.ia_confianza === 'media' ? '● media' : '● baja'}
                  </span>
                </div>
                <div style={s.listaExp}>{f.expedidor || '—'}</div>
                <div style={s.listaRowBot}>
                  <span style={s.listaFecha}>
                    {f.fecha_expedicion ? new Date(f.fecha_expedicion).toLocaleDateString('es-ES') : '—'}
                  </span>
                  <span style={s.listaTotal}>{total.toFixed(2)} €</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── CENTRO — PDF viewer ── */}
      <div style={s.centerCol}>
        {loadingPdf ? (
          <div style={s.visorEmpty}>
            <span style={{ fontSize: '1.5rem', color: '#6B6B6B' }}>⟳</span>
            <span style={{ color: '#6B6B6B', fontSize: '0.85rem' }}>Cargando PDF…</span>
          </div>
        ) : pdfUrl ? (
          <iframe
            src={pdfUrl}
            style={s.visorFrame}
            title="Factura PDF"
          />
        ) : (
          <div style={s.visorEmpty}>
            <div style={{ fontSize: '2.5rem', marginBottom: '8px', opacity: 0.4 }}>📄</div>
            <span style={{ color: '#6B6B6B', fontSize: '0.85rem' }}>PDF no disponible</span>
            <span style={{ color: '#9B9B9B', fontSize: '0.75rem', marginTop: '4px' }}>La factura fue procesada sin archivo adjunto</span>
          </div>
        )}
      </div>

      {/* ── DERECHA — editor ── */}
      {seleccionada && (
        <div style={s.rightCol}>
          <div style={s.editorShell}>

            <div style={s.editorTop}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, flex: 1 }}>
                {seleccionada.num_factura || 'Sin número'}
              </span>
              {seleccionada.ia_confianza && (
                <span style={{
                  fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                  background: seleccionada.ia_confianza === 'alta' ? '#E8F5E9' : seleccionada.ia_confianza === 'media' ? '#FFF8E1' : '#FFF3E0',
                  color: seleccionada.ia_confianza === 'alta' ? '#2E7D32' : seleccionada.ia_confianza === 'media' ? '#F57F17' : '#E65100',
                }}>
                  IA {seleccionada.ia_confianza}
                </span>
              )}
            </div>

            <div style={s.editorScroll}>

              <F label="Nº Factura"  value={seleccionada.num_factura}      onChange={v => editarCampo('num_factura', v)} mono />
              <F label="Expedidor"   value={seleccionada.expedidor}         onChange={v => editarCampo('expedidor', v)} />
              <F label="NIF/CIF"     value={seleccionada.nif_expedidor}     onChange={v => editarCampo('nif_expedidor', v)} mono />
              <F label="Concepto"    value={seleccionada.concepto}          onChange={v => editarCampo('concepto', v)} />

              <div style={s.divider} />

              <div style={s.grid2}>
                <F label="Fecha expedición" value={seleccionada.fecha_expedicion} onChange={v => editarCampo('fecha_expedicion', v)} />
                <F label="Fecha operación"  value={seleccionada.fecha_operacion}  onChange={v => editarCampo('fecha_operacion', v)} />
              </div>

              <div style={s.divider} />

              <div style={s.grid2}>
                <F label="Base imponible" value={seleccionada.base_imponible} onChange={v => editarCampo('base_imponible', v)} right />
                <F label="% IVA"          value={seleccionada.pct_iva}        onChange={v => editarCampo('pct_iva', v)} right />
              </div>
              <div style={s.grid2}>
                <F label="Cuota IVA"  value={seleccionada.cuota_iva} onChange={v => editarCampo('cuota_iva', v)} right />
                <F label="Deducible"  value={seleccionada.deducible} onChange={v => editarCampo('deducible', v)} right />
              </div>

              {/* Líneas extra */}
              {(seleccionada.lineas_extra || []).length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  {(seleccionada.lineas_extra || []).map((linea, idx) => (
                    <div key={idx} style={s.lineaBox}>
                      <span style={s.lineaTag}>Línea {idx + 2} — {linea.pct_iva}% IVA</span>
                      <div style={s.grid2}>
                        <F label="Base"      value={linea.base_imponible} onChange={v => editarLineaExtra(idx, 'base_imponible', v)} right />
                        <F label="% IVA"     value={linea.pct_iva}        onChange={v => editarLineaExtra(idx, 'pct_iva', v)} right />
                        <F label="Cuota"     value={linea.cuota_iva}      onChange={v => editarLineaExtra(idx, 'cuota_iva', v)} right />
                        <F label="Deducible" value={linea.deducible}      onChange={v => editarLineaExtra(idx, 'deducible', v)} right />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Total */}
              <div style={s.totalBox}>
                <span style={s.totalLabel}>Total factura</span>
                <span style={s.totalValor}>{totalFactura.toFixed(2)} €</span>
              </div>

              {/* Notas IA */}
              {seleccionada.ia_raw?.notas && (
                <div style={s.notasBox}>⚠ {seleccionada.ia_raw.notas}</div>
              )}

            </div>

            <div style={s.editorFooter}>
              <button onClick={eliminarFactura} disabled={guardando} style={s.btnErrFull}>
                🗑 Descartar
              </button>
              <button onClick={validarFactura} disabled={guardando} style={s.btnOkFull}>
                {guardando ? '…' : '✓ Validar factura'}
              </button>
            </div>

          </div>
        </div>
      )}

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
  appShell:    { position: 'fixed', top: `${NAV_H}px`, left: 0, right: 0, bottom: 0, display: 'grid', gridTemplateColumns: '240px 1fr 420px', background: '#1a1a1a', zIndex: 50, padding: '8px', gap: '8px' },

  leftCol:     { display: 'flex', flexDirection: 'column', background: '#F5F3EE', overflow: 'hidden', borderRadius: '8px' },
  leftHeader:  { padding: '10px 14px', borderBottom: '1px solid #D8D4CB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', flexShrink: 0 },
  leftTitle:   { fontSize: '0.82rem', fontWeight: 700 },
  leftScroll:  { flex: 1, overflowY: 'auto' },
  btnCerrarX:  { background: 'transparent', border: '1px solid #D8D4CB', borderRadius: '6px', padding: '4px 8px', fontSize: '0.75rem', cursor: 'pointer', color: '#6B6B6B', fontWeight: 700 },

  listaItem:    { padding: '10px 14px', borderBottom: '1px solid #EDEAE3', cursor: 'pointer', transition: 'background 0.1s' },
  listaItemSel: { background: '#E8F5E9', borderLeft: '3px solid #1A472A' },
  listaRowTop:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' },
  listaNum:     { fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 700 },
  listaExp:     { fontSize: '0.78rem', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  listaRowBot:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  listaFecha:   { fontSize: '0.7rem', color: '#6B6B6B' },
  listaTotal:   { fontSize: '0.78rem', fontWeight: 600, color: '#1A472A' },

  centerCol:   { display: 'flex', flexDirection: 'column', background: '#1E1E1E', overflow: 'hidden', borderRadius: '8px', position: 'relative' },
  visorFrame:  { width: '100%', height: '100%', border: 'none', display: 'block' },
  visorEmpty:  { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6B6B6B', gap: '6px', height: '100%' },

  rightCol:    { display: 'flex', overflow: 'hidden', borderRadius: '8px', background: '#fff' },
  editorShell: { display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' },
  editorTop:   { padding: '10px 14px', borderBottom: '1px solid #D8D4CB', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: '#fafafa' },
  editorScroll:{ flex: 1, overflowY: 'auto', padding: '14px' },
  editorFooter:{ padding: '12px 14px', borderTop: '1px solid #D8D4CB', display: 'flex', gap: '8px', flexShrink: 0, background: '#fff' },
  btnOkFull:   { flex: 2, background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7', borderRadius: '7px', padding: '11px', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer' },
  btnErrFull:  { flex: 1, background: '#FFF3E0', color: '#E65100', border: '1px solid #FFCC80', borderRadius: '7px', padding: '11px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  btnCerrar:   { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' },

  fieldGroup:  { marginBottom: '10px' },
  label:       { display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' },
  input:       { width: '100%', padding: '7px 9px', border: '1px solid #D8D4CB', borderRadius: '6px', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  divider:     { borderTop: '1px solid #EDEAE3', margin: '12px 0' },
  grid2:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
  totalBox:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#E8F5E9', borderRadius: '6px', padding: '10px 12px', marginTop: '10px' },
  totalLabel:  { fontSize: '0.78rem', fontWeight: 600, color: '#1A472A' },
  totalValor:  { fontSize: '1.1rem', fontWeight: 700, color: '#1A472A' },
  lineaBox:    { background: '#F5F3EE', borderRadius: '6px', padding: '10px', marginBottom: '8px' },
  lineaTag:    { display: 'inline-block', background: '#1A472A', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '0.68rem', fontWeight: 700, marginBottom: '8px' },
  notasBox:    { background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '6px', padding: '8px 10px', fontSize: '0.78rem', color: '#F57F17', marginTop: '12px' },
}
