import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { exportarA3 } from '../lib/exportarA3'
import SubirFacturas from '../components/SubirFacturas'
import RevisarPendientes from '../components/RevisarPendientes'

export default function Facturas() {
  const { clienteId } = useParams()
  const navigate      = useNavigate()

  const [cliente,        setCliente]        = useState(null)
  const [facturas,       setFacturas]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [mostrarSubida,  setMostrarSubida]  = useState(false)
  const [mostrarRevisar, setMostrarRevisar] = useState(false)

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

  function handleExportar() {
    if (!facturas.length) return
    exportarA3({
      facturas: facturas.map(f => ({
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
  }

  if (!cliente) return <p style={{ color: '#6B6B6B' }}>Cargando…</p>

  const validadas  = facturas.filter(f => f.estado === 'validada')
  const pendientes = facturas.filter(f => f.estado === 'pendiente' || f.estado === 'revisar')
  const errores    = facturas.filter(f => f.estado === 'error')

  return (
    <div>
      <div style={s.breadcrumb}>
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
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>{['Nº Factura','Expedidor','Fecha','Base Imp.','% IVA','Cuota','Estado'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {facturas.map(f => (
                <tr key={f.id}>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.8rem' }}>{f.num_factura || '—'}</td>
                  <td style={s.td}>{f.expedidor || '—'}</td>
                  <td style={{ ...s.td, fontSize: '0.82rem' }}>{f.fecha_expedicion ? new Date(f.fecha_expedicion).toLocaleDateString('es-ES') : '—'}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{f.base_imponible != null ? `${Number(f.base_imponible).toFixed(2)} €` : '—'}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{f.pct_iva ? `${f.pct_iva}%` : '—'}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{f.cuota_iva != null ? `${Number(f.cuota_iva).toFixed(2)} €` : '—'}</td>
                  <td style={s.td}><EstadoBadge estado={f.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  tableWrap:     { background: '#fff', border: '1px solid #D8D4CB', borderRadius: '10px', overflow: 'hidden' },
  table:         { width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' },
  th:            { padding: '10px 14px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.5px', background: '#F5F3EE', borderBottom: '1px solid #D8D4CB' },
  td:            { padding: '12px 14px', borderBottom: '1px solid #EDEAE3', color: '#1C1C1C' },
}
