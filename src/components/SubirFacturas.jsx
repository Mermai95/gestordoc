import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { PDFDocument } from 'pdf-lib'

export default function SubirFacturas({ clienteId, onFacturasGuardadas }) {
  const { user }      = useAuth()
  const fileInputRef  = useRef()
  const [dragOver,    setDragOver]    = useState(false)
  const [cola,        setCola]        = useState([])
  const [filas,       setFilas]       = useState([])
  const [seleccionId, setSeleccionId] = useState(null)
  const [guardando,   setGuardando]   = useState(false)

  const filaSeleccionada = filas.find(f => f.id === seleccionId) || filas[0] || null

  function onDragOver(e)   { e.preventDefault(); setDragOver(true) }
  function onDragLeave()   { setDragOver(false) }
  function onDrop(e)       { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)) }
  function onFileChange(e) { handleFiles(Array.from(e.target.files)); e.target.value = '' }

  function handleFiles(files) {
    files.filter(f => ['application/pdf','image/jpeg','image/png','image/webp'].includes(f.type)).forEach(procesarArchivo)
  }

  async function procesarArchivo(file) {
    if (file.type === 'application/pdf') await procesarPDF(file)
    else await procesarImagen(file)
  }

  async function procesarPDF(file) {
    const buffer   = await file.arrayBuffer()
    const pdfDoc   = await PDFDocument.load(buffer)
    const numPages = pdfDoc.getPageCount()

    for (let i = 0; i < numPages; i++) {
      const id     = crypto.randomUUID()
      const nombre = numPages === 1 ? file.name : `${file.name} — pág. ${i+1}/${numPages}`
      setCola(c => [...c, { id, nombre, estado: 'procesando' }])
      try {
        const paginaDoc   = await PDFDocument.create()
        const [pagina]    = await paginaDoc.copyPages(pdfDoc, [i])
        paginaDoc.addPage(pagina)
        const paginaBytes = await paginaDoc.save()
        const paginaBlob  = new Blob([paginaBytes], { type: 'application/pdf' })
        const paginaFile  = new File([paginaBlob], `pagina_${i+1}.pdf`, { type: 'application/pdf' })
        const resultado   = await llamarEdgeFunction(paginaFile)
        if (resultado?.es_factura === false) { setCola(c => c.filter(x => x.id !== id)); continue }
        setCola(c => c.map(x => x.id === id ? { ...x, estado: 'listo' } : x))
        setFilas(f => {
          const nuevas = [...f, { id, archivo: paginaFile, nombre, datos: resultado, estado: 'pendiente', previewUrl: URL.createObjectURL(paginaBlob) }]
          if (f.length === 0) setSeleccionId(id)
          return nuevas
        })
      } catch (err) {
        console.error(err)
        setCola(c => c.map(x => x.id === id ? { ...x, estado: 'error' } : x))
        setFilas(f => [...f, { id, archivo: file, nombre, datos: null, estado: 'error', previewUrl: null }])
      }
    }
  }

  async function procesarImagen(file) {
    const id = crypto.randomUUID()
    setCola(c => [...c, { id, nombre: file.name, estado: 'procesando' }])
    try {
      const resultado = await llamarEdgeFunction(file)
      setCola(c => c.map(x => x.id === id ? { ...x, estado: 'listo' } : x))
      setFilas(f => {
        const nuevas = [...f, { id, archivo: file, nombre: file.name, datos: resultado, estado: 'pendiente', previewUrl: URL.createObjectURL(file) }]
        if (f.length === 0) setSeleccionId(id)
        return nuevas
      })
    } catch (err) {
      console.error(err)
      setCola(c => c.map(x => x.id === id ? { ...x, estado: 'error' } : x))
      setFilas(f => [...f, { id, archivo: file, nombre: file.name, datos: null, estado: 'error', previewUrl: null }])
    }
  }

  async function llamarEdgeFunction(file) {
    const { data: { session } } = await supabase.auth.getSession()
    const formData = new FormData()
    formData.append('archivo', file)
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/procesar-factura`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY }, body: formData }
    )
    if (!response.ok) throw new Error(await response.text())
    return await response.json()
  }

  function editarCampo(id, campo, valor) {
    setFilas(f => f.map(fila => {
      if (fila.id !== id) return fila
      const datos = { ...fila.datos, [campo]: valor }
      if (campo === 'base_imponible' || campo === 'pct_iva') {
        const base  = parseFloat(campo === 'base_imponible' ? valor : datos.base_imponible) || 0
        const pct   = parseFloat((campo === 'pct_iva' ? valor : datos.pct_iva)?.toString().replace(',', '.')) || 0
        const cuota = Math.round(base * pct / 100 * 100) / 100
        datos.cuota_iva = cuota.toFixed(2)
        datos.deducible = cuota.toFixed(2)
      }
      return { ...fila, datos }
    }))
  }

  function editarLineaExtra(id, idx, campo, valor) {
    setFilas(f => f.map(fila => {
      if (fila.id !== id) return fila
      const lineas = [...(fila.datos.lineas_extra || [])]
      lineas[idx] = { ...lineas[idx], [campo]: valor }
      if (campo === 'base_imponible' || campo === 'pct_iva') {
        const base  = parseFloat(campo === 'base_imponible' ? valor : lineas[idx].base_imponible) || 0
        const pct   = parseFloat((campo === 'pct_iva' ? valor : lineas[idx].pct_iva)?.toString().replace(',', '.')) || 0
        const cuota = Math.round(base * pct / 100 * 100) / 100
        lineas[idx].cuota_iva = cuota.toFixed(2)
        lineas[idx].deducible = cuota.toFixed(2)
      }
      return { ...fila, datos: { ...fila.datos, lineas_extra: lineas } }
    }))
  }

  function setEstadoFila(id, estado) {
    setFilas(f => f.map(fila => fila.id === id ? { ...fila, estado } : fila))
    // Al validar, seleccionar la siguiente pendiente automáticamente
    if (estado === 'validada') {
      const pendientes = filas.filter(f => f.id !== id && f.estado === 'pendiente')
      if (pendientes.length > 0) setSeleccionId(pendientes[0].id)
    }
  }

  async function guardarValidadas() {
    const validadas = filas.filter(f => f.estado === 'validada')
    if (!validadas.length) return
    setGuardando(true)
    for (const fila of validadas) {
      try {
        const ext      = fila.archivo.name.split('.').pop()
        const rutaFile = `${user.id}/${clienteId}/${fila.id}.${ext}`
        await supabase.storage.from('facturas').upload(rutaFile, fila.archivo)
        const parseDate = str => {
          if (!str) return null
          if (str.includes('/')) { const [d,m,y] = str.split('/').map(Number); return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` }
          return str
        }
        const { datos } = fila
        await supabase.from('facturas').insert({
          cliente_id: clienteId, tipo: 'recibida', estado: 'validada',
          num_factura: datos.num_factura || null,
          fecha_expedicion: parseDate(datos.fecha_expedicion),
          fecha_operacion:  parseDate(datos.fecha_operacion),
          concepto: datos.concepto || null, nif_expedidor: datos.nif_expedidor || null,
          expedidor: datos.expedidor || null,
          base_imponible: parseFloat(datos.base_imponible) || 0,
          pct_iva: datos.pct_iva || '21,0',
          cuota_iva: parseFloat(datos.cuota_iva) || 0,
          deducible: parseFloat(datos.deducible) || 0,
          lineas_extra: datos.lineas_extra || [],
          archivo_url: rutaFile, archivo_nombre: fila.nombre,
          ia_raw: datos, ia_confianza: datos.confianza || 'media',
        })
      } catch (err) { console.error('Error guardando factura:', err) }
    }
    filas.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl) })
    setGuardando(false); setFilas([]); setCola([]); setSeleccionId(null)
    onFacturasGuardadas?.()
  }

  const validadas  = filas.filter(f => f.estado === 'validada').length
  const pendientes = filas.filter(f => f.estado === 'pendiente').length

  // ── Drop zone inicial ──────────────────────────────────────────────────────
  if (filas.length === 0 && cola.length === 0) {
    return (
      <div style={s.dropWrap} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={() => fileInputRef.current.click()}>
        <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple style={{ display: 'none' }} onChange={onFileChange} />
        <div style={s.dropIcon}>📄</div>
        <p style={s.dropTitle}>Arrastra facturas aquí</p>
        <p style={s.dropSub}>PDF multipágina, JPG, PNG · Separa automáticamente cada factura</p>
        <button style={s.dropBtn} onClick={e => { e.stopPropagation(); fileInputRef.current.click() }}>Seleccionar archivos</button>
      </div>
    )
  }

  // ── Visor tipo app escritorio ──────────────────────────────────────────────
  return (
    <div style={s.appShell}>

      {/* IZQUIERDA — lista */}
      <div style={s.leftCol}>
        <div style={s.leftHeader}>
          <span style={s.leftTitle}>Facturas ({filas.length})</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple style={{ display: 'none' }} onChange={onFileChange} />
            <button onClick={() => fileInputRef.current.click()} style={s.btnAnadir}>+ Añadir</button>
          </div>
        </div>

        {cola.filter(c => c.estado === 'procesando').map(item => (
          <div key={item.id} style={s.colaItem}>
            <span style={s.spinner}>⟳</span>
            <span style={s.colaNombre}>{item.nombre}</span>
          </div>
        ))}

        <div style={s.leftScroll}>
          {filas.map(fila => {
            const isSelected  = fila.id === filaSeleccionada?.id
            const isValidada  = fila.estado === 'validada'
            const confColor   = { alta: '#2E7D32', media: '#F57F17', baja: '#E65100' }[fila.datos?.confianza] || '#6B6B6B'
            const total       = fila.datos ? (parseFloat(fila.datos.base_imponible||0) + parseFloat(fila.datos.cuota_iva||0)).toFixed(2) : null

            return (
              <div key={fila.id} onClick={() => setSeleccionId(fila.id)}
                style={{ ...s.listaItem, ...(isSelected ? s.listaItemSel : {}), ...(isValidada && !isSelected ? s.listaItemOk : {}) }}>
                {isValidada && !isSelected ? (
                  <div style={s.listaOkRow}>
                    <span style={s.listaOkCheck}>✓</span>
                    <span style={s.listaOkNum}>{fila.datos?.num_factura || fila.nombre}</span>
                    <span style={s.listaOkTotal}>{total}€</span>
                  </div>
                ) : (
                  <>
                    <div style={s.listaRowTop}>
                      <span style={s.listaNum}>{fila.datos?.num_factura || '—'}</span>
                      <BadgeMini estado={fila.estado} />
                    </div>
                    <div style={s.listaExp}>{fila.datos?.expedidor || fila.nombre}</div>
                    <div style={s.listaRowBot}>
                      <span style={s.listaFecha}>{fila.datos?.fecha_expedicion || ''}</span>
                      <span style={s.listaTotal}>{total ? `${total} €` : '—'}</span>
                      <span style={{ color: confColor, fontSize: '0.65rem' }}>●</span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div style={s.leftFooter}>
          <div style={s.statsRow}>
            <span style={s.statOk}>{validadas} ✓ validadas</span>
            <span style={s.statPend}>{pendientes} pendientes</span>
          </div>
          <button onClick={guardarValidadas} disabled={validadas === 0 || guardando}
            style={{ ...s.btnGuardar, opacity: validadas === 0 ? 0.4 : 1 }}>
            {guardando ? 'Guardando…' : `⬆ Guardar ${validadas} factura${validadas !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* CENTRO — visor */}
      <div style={s.centerCol}>
        {filaSeleccionada?.previewUrl ? (
          filaSeleccionada.archivo?.type === 'application/pdf'
            ? <iframe src={filaSeleccionada.previewUrl} style={s.visorFrame} title="Factura" />
            : <div style={s.visorImgWrap}><img src={filaSeleccionada.previewUrl} alt="Factura" style={s.visorImg} /></div>
        ) : (
          <div style={s.visorEmpty}><span style={{ fontSize: '3rem' }}>📄</span><p>Selecciona una factura</p></div>
        )}
      </div>

      {/* DERECHA — editor */}
      <div style={s.rightCol}>
        {filaSeleccionada?.datos ? (
          <EditorFactura
            fila={filaSeleccionada}
            onChange={(campo, valor) => editarCampo(filaSeleccionada.id, campo, valor)}
            onChangeLinea={(idx, campo, valor) => editarLineaExtra(filaSeleccionada.id, idx, campo, valor)}
            onValidar={() => setEstadoFila(filaSeleccionada.id, 'validada')}
            onError={()   => setEstadoFila(filaSeleccionada.id, 'error')}
          />
        ) : (
          <div style={s.visorEmpty}>
            {filaSeleccionada ? <p style={{ color: '#E65100' }}>✗ No se pudo leer — revisión manual</p>
              : <p style={{ color: '#6B6B6B' }}>Selecciona una factura</p>}
          </div>
        )}
      </div>

    </div>
  )
}

// ── Editor columna derecha ────────────────────────────────────────────────────
function EditorFactura({ fila, onChange, onChangeLinea, onValidar, onError }) {
  const { datos, estado } = fila
  const isValidada = estado === 'validada'
  const confColor  = { alta: '#2E7D32', media: '#F57F17', baja: '#E65100' }[datos.confianza] || '#6B6B6B'
  const total      = ((parseFloat(datos.base_imponible)||0) + (parseFloat(datos.cuota_iva)||0)).toFixed(2)
  const numMostrado = datos.num_factura || ''
  const numA3       = numMostrado.length > 10 ? numMostrado.slice(-10) : numMostrado
  const numTruncado = numMostrado.length > 10

  return (
    <div style={s.editorShell}>
      {/* Info confianza */}
      <div style={s.editorTop}>
        <span style={{ color: confColor, fontSize: '0.78rem', fontWeight: 600 }}>● Confianza {datos.confianza}</span>
        {datos.tipo === 'abono' && <span style={s.abonoBadge}>ABONO</span>}
      </div>

      {/* Campos — scroll */}
      <div style={s.editorScroll}>
        <div style={s.fieldGroup}>
          <label style={s.label}>Nº Factura {numTruncado && <span style={{ color: '#E65100' }}>→ A3: {numA3}</span>}</label>
          <input type="text" value={numMostrado} onChange={e => onChange('num_factura', e.target.value)}
            style={{ ...s.input, fontFamily: 'monospace', ...(numTruncado ? { borderColor: '#FFCC80' } : {}) }} />
        </div>
        <F label="Expedidor"    value={datos.expedidor}        onChange={v => onChange('expedidor', v)} />
        <F label="NIF / CIF"   value={datos.nif_expedidor}    onChange={v => onChange('nif_expedidor', v)} mono />
        <F label="Fecha"       value={datos.fecha_expedicion} onChange={v => onChange('fecha_expedicion', v)} />
        <F label="F. Operación" value={datos.fecha_operacion} onChange={v => onChange('fecha_operacion', v)} />
        <F label="Concepto"    value={datos.concepto}         onChange={v => onChange('concepto', v)} />

        <div style={s.divider} />

        <div style={s.grid2}>
          <F label="Base Imp."  value={datos.base_imponible} onChange={v => onChange('base_imponible', v)} right />
          <F label="% IVA"      value={datos.pct_iva}        onChange={v => onChange('pct_iva', v)} right />
          <F label="Cuota IVA"  value={datos.cuota_iva}      onChange={v => onChange('cuota_iva', v)} right />
          <F label="Deducible"  value={datos.deducible}      onChange={v => onChange('deducible', v)} right />
        </div>

        <div style={s.totalBox}>
          <span style={s.totalLabel}>Total factura</span>
          <span style={s.totalValor}>{total} €</span>
        </div>

        {datos.lineas_extra?.length > 0 && (
          <div style={{ marginTop: '14px' }}>
            <p style={s.label}>Líneas adicionales de IVA</p>
            {datos.lineas_extra.map((linea, idx) => (
              <div key={idx} style={s.lineaBox}>
                <span style={s.lineaTag}>IVA {linea.pct_iva}%</span>
                <div style={s.grid2}>
                  <F label="Base"      value={linea.base_imponible} onChange={v => onChangeLinea(idx, 'base_imponible', v)} right />
                  <F label="% IVA"     value={linea.pct_iva}        onChange={v => onChangeLinea(idx, 'pct_iva', v)} right />
                  <F label="Cuota"     value={linea.cuota_iva}      onChange={v => onChangeLinea(idx, 'cuota_iva', v)} right />
                  <F label="Deducible" value={linea.deducible}      onChange={v => onChangeLinea(idx, 'deducible', v)} right />
                </div>
              </div>
            ))}
          </div>
        )}

        {datos.notas && <div style={s.notasBox}>⚠ {datos.notas}</div>}
      </div>

      {/* Botones fijos abajo */}
      <div style={s.editorFooter}>
        <button onClick={onError} style={s.btnErrFull}>✗ Error</button>
        <button onClick={onValidar} style={{ ...s.btnOkFull, ...(isValidada ? s.btnOkActive : {}) }}>
          ✓ {isValidada ? 'Validada ✓' : 'Validar factura'}
        </button>
      </div>
    </div>
  )
}

function F({ label, value, onChange, mono, right }) {
  return (
    <div style={s.fieldGroup}>
      <label style={s.label}>{label}</label>
      <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
        style={{ ...s.input, ...(mono ? { fontFamily: 'monospace' } : {}), ...(right ? { textAlign: 'right' } : {}) }} />
    </div>
  )
}

function BadgeMini({ estado }) {
  const m = { validada: ['#E8F5E9','#2E7D32','✓'], pendiente: ['#FFF8E1','#F57F17','·'], error: ['#FFF3E0','#E65100','✗'] }
  const [bg, color, label] = m[estado] || m.pendiente
  return <span style={{ background: bg, color, padding: '1px 6px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700 }}>{label}</span>
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const NAV_H = 56 // altura del navbar en px

const s = {
  // Drop zone
  dropWrap:    { border: '2px dashed #D8D4CB', borderRadius: '10px', background: '#fff', padding: '60px 24px', textAlign: 'center', cursor: 'pointer' },
  dropIcon:    { fontSize: '3rem', marginBottom: '12px' },
  dropTitle:   { fontWeight: 700, fontSize: '1.1rem', marginBottom: '8px' },
  dropSub:     { fontSize: '0.85rem', color: '#6B6B6B', marginBottom: '18px' },
  dropBtn:     { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 24px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' },

  // Shell — ocupa todo desde debajo del navbar
  appShell:    {
    position: 'fixed',
    top: `${NAV_H}px`,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'grid',
    gridTemplateColumns: '280px 1fr 320px',
    background: '#fff',
    zIndex: 50,
  },

  // Columna izquierda
  leftCol:     { display: 'flex', flexDirection: 'column', borderRight: '1px solid #D8D4CB', background: '#F5F3EE', overflow: 'hidden' },
  leftHeader:  { padding: '12px 14px', borderBottom: '1px solid #D8D4CB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', flexShrink: 0 },
  leftTitle:   { fontSize: '0.85rem', fontWeight: 700 },
  leftScroll:  { flex: 1, overflowY: 'auto' },
  leftFooter:  { padding: '10px 14px', borderTop: '1px solid #D8D4CB', background: '#fff', flexShrink: 0 },
  colaItem:    { padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px', background: '#FFF8E1', borderBottom: '1px solid #EDEAE3', flexShrink: 0 },
  spinner:     { color: '#F57F17', fontSize: '0.9rem' },
  colaNombre:  { fontSize: '0.74rem', color: '#6B6B6B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  btnAnadir:   { background: 'transparent', border: '1px solid #D8D4CB', borderRadius: '6px', padding: '4px 10px', fontSize: '0.75rem', cursor: 'pointer' },

  // Items lista
  listaItem:   { padding: '10px 14px', borderBottom: '1px solid #EDEAE3', cursor: 'pointer', transition: 'background 0.1s' },
  listaItemSel:{ background: '#E8F5E9', borderLeft: '3px solid #1A472A' },
  listaItemOk: { background: '#F0FFF4', padding: '6px 14px' },
  listaOkRow:  { display: 'flex', alignItems: 'center', gap: '8px' },
  listaOkCheck:{ color: '#2E7D32', fontWeight: 700, fontSize: '0.78rem' },
  listaOkNum:  { flex: 1, fontSize: '0.75rem', fontFamily: 'monospace', color: '#2E7D32', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  listaOkTotal:{ fontSize: '0.75rem', fontWeight: 600, color: '#2E7D32' },
  listaRowTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' },
  listaNum:    { fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 700 },
  listaExp:    { fontSize: '0.78rem', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  listaRowBot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  listaFecha:  { fontSize: '0.7rem', color: '#6B6B6B' },
  listaTotal:  { fontSize: '0.78rem', fontWeight: 600, color: '#1A472A' },
  statsRow:    { display: 'flex', gap: '10px', marginBottom: '8px' },
  statOk:      { fontSize: '0.75rem', color: '#2E7D32', fontWeight: 600 },
  statPend:    { fontSize: '0.75rem', color: '#F57F17' },
  btnGuardar:  { width: '100%', background: '#1A472A', color: '#fff', border: 'none', borderRadius: '7px', padding: '10px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },

  // Columna central — visor
  centerCol:   { display: 'flex', flexDirection: 'column', background: '#1E1E1E', overflow: 'hidden' },
  visorFrame:  { width: '100%', height: '100%', border: 'none', display: 'block' },
  visorImgWrap:{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '20px' },
  visorImg:    { maxWidth: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' },
  visorEmpty:  { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6B6B6B', gap: '10px' },

  // Columna derecha — editor
  rightCol:    { borderLeft: '1px solid #D8D4CB', display: 'flex', overflow: 'hidden' },
  editorShell: { display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' },
  editorTop:   { padding: '10px 14px', borderBottom: '1px solid #D8D4CB', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: '#fafafa' },
  editorScroll:{ flex: 1, overflowY: 'auto', padding: '14px' },
  editorFooter:{ padding: '12px 14px', borderTop: '1px solid #D8D4CB', display: 'flex', gap: '8px', flexShrink: 0, background: '#fff' },
  btnOkFull:   { flex: 2, background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7', borderRadius: '7px', padding: '11px', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer' },
  btnOkActive: { background: '#2E7D32', color: '#fff', borderColor: '#2E7D32' },
  btnErrFull:  { flex: 1, background: '#FFF3E0', color: '#E65100', border: '1px solid #FFCC80', borderRadius: '7px', padding: '11px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },

  // Campos editor
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
  abonoBadge:  { background: '#FFF3E0', color: '#E65100', border: '1px solid #FFCC80', borderRadius: '4px', padding: '2px 8px', fontSize: '0.68rem', fontWeight: 700 },
}
