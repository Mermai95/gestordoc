import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function Clientes() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [clientes, setClientes] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState({ nombre: '', nif_cif: '', email: '', telefono: '' })
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)
  const [porConfirmar, setPorConfirmar] = useState([])
  const [nifPendiente, setNifPendiente] = useState(null)

  useEffect(() => { fetchClientes(); fetchPorConfirmar() }, [])

  async function fetchClientes() {
    setLoading(true)
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('activo', true)
      .order('nombre')
    if (!error) setClientes(data ?? [])
    setLoading(false)
  }

  async function fetchPorConfirmar() {
    const { data, error } = await supabase
      .from('facturas')
      .select('nif_cliente_asunto')
      .is('cliente_id', null)
      .not('nif_cliente_asunto', 'is', null)
    console.log('clientes por confirmar:', data, error)
    if (!data) { setPorConfirmar([]); return }
    const agrupado = {}
    data.forEach(f => {
      const nif = f.nif_cliente_asunto || 'SIN NIF'
      if (!agrupado[nif]) agrupado[nif] = { nif, expedidor: f.expedidor, count: 0 }
      agrupado[nif].count++
    })
    setPorConfirmar(Object.values(agrupado).sort((a, b) => b.count - a.count))
  }

  function abrirCrearDesdeNif(nif, expedidor) {
    setForm({ nombre: expedidor || '', nif_cif: nif === 'SIN NIF' ? '' : nif, email: '', telefono: '' })
    setNifPendiente(nif === 'SIN NIF' ? null : nif)
    setModal(true)
  }

  async function handleCrear(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { data: nuevoCliente, error: insertErr } = await supabase
      .from('clientes')
      .insert({ ...form, gestor_id: user.id })
      .select('id')
      .single()
    if (insertErr) {
      setError('Error al crear el cliente')
    } else {
      if (nifPendiente && nuevoCliente) {
        await supabase
          .from('facturas')
          .update({ cliente_id: nuevoCliente.id })
          .is('cliente_id', null)
          .eq('nif_cliente_asunto', nifPendiente)
      }
      setModal(false)
      setForm({ nombre: '', nif_cif: '', email: '', telefono: '' })
      setNifPendiente(null)
      fetchClientes()
      fetchPorConfirmar()
    }
    setSaving(false)
  }

  if (loading) return <p style={styles.muted}>Cargando clientes…</p>

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Clientes</h1>
          <p style={styles.sub}>{clientes.length} empresa{clientes.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => { setForm({ nombre: '', nif_cif: '', email: '', telefono: '' }); setNifPendiente(null); setModal(true) }} style={styles.btnPrimary}>+ Nuevo cliente</button>
      </div>

      {porConfirmar.length > 0 && (
        <div style={styles.pcBox}>
          <div style={styles.pcHeader}>
            <span style={styles.pcTitle}>⚠️ Clientes por confirmar</span>
            <span style={styles.pcSub}>{porConfirmar.length} NIF{porConfirmar.length !== 1 ? 's' : ''} sin cliente asignado</span>
          </div>
          {porConfirmar.map(g => (
            <div key={g.nif} style={styles.pcRow}>
              <span style={styles.pcNif}>{g.nif}</span>
              <span style={styles.pcExp}>{g.expedidor || '—'}</span>
              <span style={styles.pcCount}>{g.count} factura{g.count !== 1 ? 's' : ''}</span>
              <button onClick={() => abrirCrearDesdeNif(g.nif, g.expedidor)} style={styles.pcBtn}>+ Crear cliente</button>
            </div>
          ))}
        </div>
      )}

      {clientes.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>🏢</div>
          <p style={styles.emptyTitle}>Aún no hay clientes</p>
          <p style={styles.emptySub}>Añade tu primer cliente para empezar</p>
        </div>
      ) : (
        <div style={styles.grid}>
          {clientes.map(c => (
            <div
              key={c.id}
              style={styles.card}
              onClick={() => navigate(`/clientes/${c.id}`)}
            >
              <div style={styles.cardInitial}>{c.nombre[0]}</div>
              <div style={styles.cardBody}>
                <p style={styles.cardName}>{c.nombre}</p>
                <p style={styles.cardNif}>{c.nif_cif}</p>
                {c.email && <p style={styles.cardEmail}>{c.email}</p>}
              </div>
              <span style={styles.arrow}>→</span>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div style={styles.overlay} onClick={() => setModal(false)}>
          <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>{nifPendiente ? 'Confirmar cliente' : 'Nuevo cliente'}</h2>
            {nifPendiente && (
              <p style={styles.nifHint}>Al confirmar se asignarán automáticamente las facturas pendientes de este NIF</p>
            )}
            <form onSubmit={handleCrear} style={styles.form}>
              <Field label="Nombre / Razón social *" value={form.nombre}    onChange={v => setForm(f => ({...f, nombre: v}))}   required />
              <Field label="NIF / CIF *"              value={form.nif_cif}  onChange={v => setForm(f => ({...f, nif_cif: v}))}  required />
              <Field label="Email"                    value={form.email}    onChange={v => setForm(f => ({...f, email: v}))}    type="email" />
              <Field label="Teléfono"                 value={form.telefono} onChange={v => setForm(f => ({...f, telefono: v}))} />
              {error && <p style={styles.error}>{error}</p>}
              <div style={styles.modalActions}>
                <button type="button" onClick={() => setModal(false)} style={styles.btnSecondary}>Cancelar</button>
                <button type="submit" disabled={saving} style={styles.btnPrimary}>{saving ? 'Guardando…' : 'Crear cliente'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, required, type = 'text' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1C1C1C' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        style={{ padding: '9px 11px', border: '1px solid #D8D4CB', borderRadius: '7px', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none' }}
      />
    </div>
  )
}

const styles = {
  header:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' },
  title:       { fontSize: '1.5rem', fontWeight: 700, color: '#1C1C1C', margin: 0 },
  sub:         { fontSize: '0.82rem', color: '#6B6B6B', marginTop: '4px' },
  muted:       { color: '#6B6B6B', fontSize: '0.9rem' },
  btnPrimary:  { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary:{ background: 'transparent', color: '#1C1C1C', border: '1px solid #D8D4CB', borderRadius: '8px', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  grid:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' },
  card:        { background: '#fff', border: '1px solid #D8D4CB', borderRadius: '10px', padding: '18px 16px', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', transition: 'box-shadow 0.15s' },
  cardInitial: { width: '40px', height: '40px', borderRadius: '50%', background: '#E8F5E9', color: '#1A472A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1rem', flexShrink: 0 },
  cardBody:    { flex: 1, minWidth: 0 },
  cardName:    { fontWeight: 600, fontSize: '0.9rem', margin: 0, color: '#1C1C1C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardNif:     { fontSize: '0.78rem', color: '#6B6B6B', fontFamily: 'monospace', margin: '2px 0 0' },
  cardEmail:   { fontSize: '0.76rem', color: '#6B6B6B', margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  arrow:       { color: '#D8D4CB', fontSize: '1rem', flexShrink: 0 },
  empty:       { textAlign: 'center', padding: '80px 24px', color: '#6B6B6B' },
  emptyIcon:   { fontSize: '3rem', marginBottom: '12px' },
  emptyTitle:  { fontWeight: 700, fontSize: '1rem', color: '#1C1C1C', marginBottom: '6px' },
  emptySub:    { fontSize: '0.85rem' },
  overlay:     { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px' },
  modalCard:   { background: '#fff', borderRadius: '12px', padding: '32px 28px', width: '100%', maxWidth: '440px' },
  modalTitle:  { fontSize: '1.1rem', fontWeight: 700, margin: '0 0 20px' },
  form:        { display: 'flex', flexDirection: 'column', gap: '14px' },
  modalActions:{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' },
  error:       { fontSize: '0.82rem', color: '#E65100', background: '#FFF3E0', padding: '8px 12px', borderRadius: '6px' },
  nifHint:     { fontSize: '0.82rem', color: '#6B6B6B', margin: '0 0 12px', lineHeight: 1.4 },
  pcBox:       { background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '10px', marginBottom: '24px', overflow: 'hidden' },
  pcHeader:    { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: '#FFF3E0', borderBottom: '1px solid #FFE082' },
  pcTitle:     { fontSize: '0.92rem', fontWeight: 700, color: '#B8860B' },
  pcSub:       { fontSize: '0.78rem', color: '#B8860B' },
  pcRow:       { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', borderBottom: '1px solid #FFEECB' },
  pcNif:       { fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, color: '#1C1C1C', minWidth: '110px' },
  pcExp:       { flex: 1, fontSize: '0.85rem', color: '#4A4A4A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pcCount:     { fontSize: '0.78rem', color: '#B8860B', fontWeight: 600, whiteSpace: 'nowrap' },
  pcBtn:       { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
}
