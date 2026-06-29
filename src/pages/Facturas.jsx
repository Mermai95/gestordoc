import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { exportarA3 } from '../lib/exportarA3'
import SubirFacturas from '../components/SubirFacturas'
import RevisarPendientes from '../components/RevisarPendientes'

const ESTADOS_TABS = [
  { key: null,         label: 'Todas' },
  { key: 'revisar',    label: 'Revisar' },
  { key: 'procesada',  label: 'Procesada' },
  { key: 'pendiente',  label: 'Pendiente' },
  { key: 'validada',   label: 'Validada' },
  { key: 'exportada',  label: 'Exportada' },
  { key: 'error',      label: 'Error' },
]

const COLUMNAS = [
  { key: 'num_factura',      label: 'Nº Factura', w: 130 },
  { key: 'expedidor',        label: 'Expedidor',  w: 200 },
  { key: 'fecha_expedicion', label: 'Fecha',      w: 110 },
  { key: 'base_imponible',   label: 'Base Imp.',  w: 110, align: 'right' },
  { key: 'pct_iva',          label: '% IVA',      w: 80,  align: 'right' },
  { key: 'cuota_iva',        label: 'Cuota',      w: 110, align: 'right' },
  { key: 'estado',           label: 'Estado',     w: 120 },
]

export default function Facturas() {
  const { clienteId } = useParams()
  const navigate      = useNavigate()

  const [cliente,        setCliente]        = useState(null)
  const [facturas,       setFacturas]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [mostrarSubida,  setMostrarSubida]  = useState(false)
  const [mostrarRevisar, setMostrarRevisar] = useState(false)
  const [filtroEstado,   setFiltroEstado]   = useState(null)
  const [cols,           setCols]           = useState(COLUMNAS.map(c => ({ ...c })))
  const resizingRef = useRef(null)

  useEffect(() => {
    fetchCliente()
    fetchFacturas()
  }, [clienteId])

  async function fetchCliente() {
    const { data } = await supabase.from('clientes').select('*').eq('id', clienteId).single()
    setCliente(data)
  }

  async function fetchFacturas() {
    setLoading(true)
    const { data } = await supabase.from('facturas').select('*').eq('cliente_id', clienteId).order('fecha_expedicion', { ascending: false })
    setFacturas(data ?? [])
    setLoading(false)
  }

  function handleFacturasGuardadas() {
    setMostrarSubida(false)
    fetchFacturas()
  }

  if (!cliente) return <p style={{ color: '#6B6B6B' }}>Cargando…</p>

  const validadas  = facturas.filter(f => f.estado === 'validada')
  const pendientes = facturas.filter(f => f.estado === 'pendiente' || f.estado === 'revisar')
  const errores    = facturas.filter(f => f.estado === 'error')
  const filtradas  = filtroEstado ? facturas.filter(f => f.estado === filtroEstado) : facturas

  async function handleExportar() {
    if (!validadas.length) return
    exportarA3({
      facturas: validadas.map(f => ({
        num_factura: f.num_factura, fecha_expedicion: f.fecha_expedicion,
        fecha_operacion: f.fecha_operacion, concepto: f.concepto,
        nif_expedidor: f.nif_expedidor, expedidor: f.expedidor,
        base_imponible: f.base_imponible, pct_iva: f.pct_iva,
        cuota: f.cuota_iva, deducible: f.deducible, lineas_extra: f.lineas_extra || [],
      })),
      nombreEmpresa: cliente?.nombre ?? '',
      periodoInicio: '01 Ene',
      periodoFin: `31 Dic ${new Date().getFullYear()}`,
    })
    const ids = validadas.map(f => f.id)
    console.log('[exportar] IDs a marcar como exportada:', ids)
    const { data: updData, error: updError } = await supabase
      .from('facturas')
      .update({ estado: 'exportada' })
      .in('id', ids)
      .select()
    console.log('[exportar] update result:', { data: updData, error: updError })
    await fetchFacturas()
  }

  function onResizeStart(e, idx) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = cols[idx].w
    function onMove(ev) {
      const newW = Math.max(50, startW + (ev.clientX - startX))
      setCols(cs => { const n = [...cs]; n[idx] = { ...n[idx], w: newW }; return n })
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function renderCelda(f, col) {
    switch (col.key) {
      case 'num_factura':      return f.num_factura || '—'
      case 'expedidor':        return f.expedidor || '—'
      case 'fecha_expedicion': return f.fecha_expedicion ? new Date(f.fecha_expedicion).toLocaleDateString('es-ES') : '—'
      case 'base_imponible':   return f.base_imponible != null ? `${Number(f.base_imponible).toFixed(2)} €` : '—'
      case 'pct_iva':          return f.pct_iva ? `${f.pct_iva}%` : '—'
      case 'cuota_iva':        return f.cuota_iva != null ? `${Number(f.cuota_iva).toFixed(2)} €` : '—'
      case 'estado':           return <EstadoBadge estado={f.estado} />
      default:                 return '—'
    }
  }

  function tdStyle(col) {
    return {
      ...s.td,
      width: col.w + 'px',
      textAlign: col.align || 'left',
      ...(col.key === 'num_factura' ? { fontFamily: 'monospace', fontSize: '0.8rem' } : {}),
      ...(col.key === 'fecha_expedicion' ? { fontSize: '0.82rem' } : {}),
    }
  }

  return (
    <div>
      <div style={s.breadcrumb}>
        <button onClick={() => navigate('/clientes')} style={s.btnBack}>← Volver</button>
        <span onClick={() => navigate('/clientes')} style={s.breadLink}>Clientes</span>
        <span style={s.breadSep}>/</span>
        <span style={s.breadCurrent}>{cliente.nombre}</span>
      </div>

      <div style={s.header}>
        <div>
          <h1 style={s.title}>{cliente.nombre}</h1>
          <span style={s.nif}>{cliente.nif_cif}</span>
        </div>
        <div style={s.headerActions}>
          <button
            onClick={handleExportar}
            disabled={validadas.length === 0}
            style={{ ...s.btnSecondary, opacity: validadas.length === 0 ? 0.4 : 1 }}
          >
            ⬇ Exportar Excel A3 ({validadas.length})
          </button>
          {pendientes.length > 0 && (
            <button onClick={() => setMostrarRevisar(true)} style={s.btnPendiente}>
              ● Revisar pendientes ({pendientes.length})
            </button>
          )}
          <button onClick={() => setMostrarSubida(v => !v)} style={s.btnPrimary}>
            {mostrarSubida ? '✕ Cerrar' : '+ Subir facturas'}
          </button>
        </div>
      </div>

      <div style={s.statsRow}>
        <Stat label="Validadas"  value={validadas.length}  color="#2E7D32" />
        <Stat label="Pendientes" value={pendientes.length} color="#F57F17" />
        <Stat label="Con error"  value={errores.length}    color="#E65100" />
        <Stat label="Total"      value={facturas.length}   color="#1C1C1C" />
      </div>

      {mostrarSubida && (
        <div style={s.subidaPanel}>
          <SubirFacturas clienteId={clienteId} onFacturasGuardadas={handleFacturasGuardadas} />
        </div>
      )}

      {loading ? (
        <p style={{ color: '#6B6B6B', fontSize: '0.9rem' }}>Cargando facturas…</p>
      ) : facturas.length === 0 ? (
        <div style={s.empty}>
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🗂️</div>
          <p style={s.emptyTitle}>Sin facturas todavía</p>
          <p style={s.emptySub}>Pulsa "+ Subir facturas" para empezar</p>
        </div>
      ) : (
        <>
          <div style={s.tabsRow}>
            {ESTADOS_TABS.map(tab => {
              const count = tab.key ? facturas.filter(f => f.estado === tab.key).length : facturas.length
              const activo = filtroEstado === tab.key
              return (
                <button
                  key={tab.key ?? 'todas'}
                  onClick={() => setFiltroEstado(tab.key)}
                  style={{ ...s.tab, ...(activo ? s.tabActivo : {}) }}
                >
                  {tab.label} ({count})
                </button>
              )
            })}
          </div>

          <div style={s.tableWrap}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ ...s.table, width: cols.reduce((a, c) => a + c.w, 0) + 'px', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    {cols.map((col, idx) => (
                      <th key={col.key} style={{ ...s.th, width: col.w + 'px', position: 'relative', textAlign: col.align || 'left' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>
                          {col.label}
                        </span>
                        <div style={s.resizer} onMouseDown={e => onResizeStart(e, idx)} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map(f => (
                    <tr key={f.id}>
                      {cols.map(col => (
                        <td key={col.key} style={tdStyle(col)}>
                          {renderCelda(f, col)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {mostrarRevisar && (
        <RevisarPendientes
          clienteId={clienteId}
          onCerrar={() => { setMostrarRevisar(false); fetchFacturas() }}
          onValidada={fetchFacturas}
        />
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #D8D4CB', borderRadius: '10px', padding: '16px 20px', minWidth: '120px' }}>
      <p style={{ fontSize: '0.75rem', color: '#6B6B6B', margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: '1.5rem', fontWeight: 700, color, margin: 0 }}>{value}</p>
    </div>
  )
}

function EstadoBadge({ estado }) {
  const map = {
    validada:  { bg: '#E8F5E9', color: '#2E7D32', label: '✓ Validada'  },
    pendiente: { bg: '#FFF8E1', color: '#F57F17', label: '· Pendiente' },
    revisar:   { bg: '#FFF8E1', color: '#F57F17', label: '· Revisar'   },
    procesada: { bg: '#E3F2FD', color: '#1565C0', label: '· Procesada' },
    exportada: { bg: '#E8F5E9', color: '#1A472A', label: '⬇ Exportada' },
    error:     { bg: '#FFF3E0', color: '#E65100', label: '✗ Error'     },
  }
  const st = map[estado] || map.pendiente
  return <span style={{ background: st.bg, color: st.color, padding: '3px 9px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600 }}>{st.label}</span>
}

const s = {
  breadcrumb:    { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', fontSize: '0.82rem' },
  breadLink:     { color: '#1A472A', cursor: 'pointer', fontWeight: 600 },
  breadSep:      { color: '#D8D4CB' },
  breadCurrent:  { color: '#6B6B6B' },
  btnBack:       { background: 'none', border: 'none', color: '#1A472A', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', padding: '0 4px 0 0' },
  header:        { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' },
  title:         { fontSize: '1.4rem', fontWeight: 700, margin: '0 0 4px' },
  nif:           { fontSize: '0.8rem', color: '#6B6B6B', fontFamily: 'monospace' },
  headerActions: { display: 'flex', gap: '10px' },
  btnPrimary:    { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary:  { background: '#fff', color: '#1C1C1C', border: '1px solid #D8D4CB', borderRadius: '8px', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  btnPendiente:  { background: '#F57F17', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  statsRow:      { display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' },
  subidaPanel:   { background: '#F5F3EE', border: '1px solid #D8D4CB', borderRadius: '10px', padding: '24px', marginBottom: '28px' },
  empty:         { textAlign: 'center', padding: '60px 24px', color: '#6B6B6B' },
  emptyTitle:    { fontWeight: 700, fontSize: '1rem', color: '#1C1C1C', marginBottom: '6px' },
  emptySub:      { fontSize: '0.85rem' },
  tabsRow:       { display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' },
  tab:           { background: '#fff', color: '#6B6B6B', border: '1px solid #D8D4CB', borderRadius: '20px', padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  tabActivo:     { background: '#1A472A', color: '#fff', borderColor: '#1A472A' },
  tableWrap:     { background: '#fff', border: '1px solid #D8D4CB', borderRadius: '10px', overflow: 'hidden' },
  table:         { borderCollapse: 'collapse', fontSize: '0.88rem' },
  th:            { position: 'sticky', top: 0, padding: '10px 14px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.5px', background: '#F5F3EE', borderBottom: '1px solid #D8D4CB', borderRight: '1px solid #EDEAE3', userSelect: 'none' },
  resizer:       { position: 'absolute', top: 0, right: 0, width: '6px', height: '100%', cursor: 'col-resize', zIndex: 10, background: 'transparent' },
  td:            { padding: '12px 14px', borderBottom: '1px solid #EDEAE3', color: '#1C1C1C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
}
