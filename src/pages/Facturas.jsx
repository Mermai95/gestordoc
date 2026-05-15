import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Facturas() {
  const { clienteId } = useParams()
  const navigate      = useNavigate()

  const [cliente,  setCliente]  = useState(null)
  const [facturas, setFacturas] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetchCliente()
    fetchFacturas()
  }, [clienteId])

  async function fetchCliente() {
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', clienteId)
      .single()
    setCliente(data)
  }

  async function fetchFacturas() {
    setLoading(true)
    const { data } = await supabase
      .from('facturas')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('fecha_expedicion', { ascending: false })
    setFacturas(data ?? [])
    setLoading(false)
  }

  if (!cliente) return <p style={{ color: '#6B6B6B' }}>Cargando…</p>

  const validadas  = facturas.filter(f => f.estado === 'validada')
  const pendientes = facturas.filter(f => f.estado === 'pendiente')
  const errores    = facturas.filter(f => f.estado === 'error')

  return (
    <div>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <span onClick={() => navigate('/clientes')} style={styles.breadLink}>Clientes</span>
        <span style={styles.breadSep}>/</span>
        <span style={styles.breadCurrent}>{cliente.nombre}</span>
      </div>

      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{cliente.nombre}</h1>
          <span style={styles.nif}>{cliente.nif_cif}</span>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.btnSecondary} disabled>
            ⬇ Exportar A3
          </button>
          <button style={styles.btnPrimary}>
            + Subir facturas
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={styles.statsRow}>
        <Stat label="Validadas"  value={validadas.length}  color="#2E7D32" />
        <Stat label="Pendientes" value={pendientes.length} color="#F57F17" />
        <Stat label="Con error"  value={errores.length}    color="#E65100" />
        <Stat label="Total"      value={facturas.length}   color="#1C1C1C" />
      </div>

      {/* Tabla / empty state */}
      {loading ? (
        <p style={{ color: '#6B6B6B', fontSize: '0.9rem' }}>Cargando facturas…</p>
      ) : facturas.length === 0 ? (
        <div style={styles.empty}>
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🗂️</div>
          <p style={styles.emptyTitle}>Sin facturas todavía</p>
          <p style={styles.emptySub}>Sube imágenes o PDFs para empezar</p>
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Nº Factura','Expedidor','Fecha','Base Imp.','% IVA','Cuota','Estado'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {facturas.map(f => (
                <tr key={f.id} style={styles.tr}>
                  <td style={{...styles.td, fontFamily: 'monospace', fontSize: '0.8rem'}}>{f.num_factura || '—'}</td>
                  <td style={styles.td}>{f.expedidor || '—'}</td>
                  <td style={{...styles.td, fontSize: '0.82rem'}}>{f.fecha_expedicion ? new Date(f.fecha_expedicion).toLocaleDateString('es-ES') : '—'}</td>
                  <td style={{...styles.td, textAlign: 'right'}}>{f.base_imponible != null ? `${Number(f.base_imponible).toFixed(2)} €` : '—'}</td>
                  <td style={{...styles.td, textAlign: 'right'}}>{f.pct_iva ? `${f.pct_iva}%` : '—'}</td>
                  <td style={{...styles.td, textAlign: 'right'}}>{f.cuota_iva != null ? `${Number(f.cuota_iva).toFixed(2)} €` : '—'}</td>
                  <td style={styles.td}><EstadoBadge estado={f.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    error:     { bg: '#FFF3E0', color: '#E65100', label: '✗ Error'     },
  }
  const s = map[estado] || map.pendiente
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600 }}>
      {s.label}
    </span>
  )
}

const styles = {
  breadcrumb:    { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', fontSize: '0.82rem' },
  breadLink:     { color: '#1A472A', cursor: 'pointer', fontWeight: 600 },
  breadSep:      { color: '#D8D4CB' },
  breadCurrent:  { color: '#6B6B6B' },
  header:        { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' },
  title:         { fontSize: '1.4rem', fontWeight: 700, margin: '0 0 4px' },
  nif:           { fontSize: '0.8rem', color: '#6B6B6B', fontFamily: 'monospace' },
  headerActions: { display: 'flex', gap: '10px' },
  btnPrimary:    { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary:  { background: '#fff', color: '#1C1C1C', border: '1px solid #D8D4CB', borderRadius: '8px', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', opacity: 0.5 },
  statsRow:      { display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' },
  empty:         { textAlign: 'center', padding: '60px 24px', color: '#6B6B6B' },
  emptyTitle:    { fontWeight: 700, fontSize: '1rem', color: '#1C1C1C', marginBottom: '6px' },
  emptySub:      { fontSize: '0.85rem' },
  tableWrap:     { background: '#fff', border: '1px solid #D8D4CB', borderRadius: '10px', overflow: 'hidden' },
  table:         { width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' },
  th:            { padding: '10px 14px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.5px', background: '#F5F3EE', borderBottom: '1px solid #D8D4CB' },
  td:            { padding: '12px 14px', borderBottom: '1px solid #EDEAE3', color: '#1C1C1C' },
  tr:            {},
}
