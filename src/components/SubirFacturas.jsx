import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { PDFDocument } from 'pdf-lib'

export default function SubirFacturas({ clienteId, onFacturasGuardadas }) {
  const { user }    = useAuth()
  const fileInputRef = useRef()
  const [dragOver,   setDragOver]   = useState(false)
  const [cola,       setCola]       = useState([])
  const [filas,      setFilas]      = useState([])
  const [guardando,  setGuardando]  = useState(false)

  function onDragOver(e)   { e.preventDefault(); setDragOver(true) }
  function onDragLeave()   { setDragOver(false) }
  function onDrop(e)       { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)) }
  function onFileChange(e) { handleFiles(Array.from(e.target.files)); e.target.value = '' }

  function handleFiles(files) {
    files
      .filter(f => ['application/pdf','image/jpeg','image/png','image/webp'].includes(f.type))
      .forEach(procesarArchivo)
  }

  async function procesarArchivo(file) {
    if (file.type === 'application/pdf') {
      await procesarPDF(file)
    } else {
      await procesarImagen(file)
    }
  }

  // ── PDF: separar página por página ────────────────────────────────────────
  async function procesarPDF(file) {
    const buffer    = await file.arrayBuffer()
    const pdfDoc    = await PDFDocument.load(buffer)
    const numPages  = pdfDoc.getPageCount()

    for (let i = 0; i < numPages; i++) {
      const id = crypto.randomUUID()
      const nombre = numPages === 1
        ? file.name
        : `${file.name} — pág. ${i + 1} de ${numPages}`

      setCola(c => [...c, { id, nombre, estado: 'procesando' }])

      try {
        // Extraer solo esta página en un PDF nuevo
        const paginaDoc = await PDFDocument.create()
        const [pagina]  = await paginaDoc.copyPages(pdfDoc, [i])
        paginaDoc.addPage(pagina)
        const paginaBytes = await paginaDoc.save()
        const paginaBlob  = new Blob([paginaBytes], { type: 'application/pdf' })
        const paginaFile  = new File([paginaBlob], `pagina_${i+1}.pdf`, { type: 'application/pdf' })

        const resultado = await llamarEdgeFunction(paginaFile)

        // Ignorar páginas en blanco o sin factura
        if (resultado?.es_factura === false) {
          setCola(c => c.filter(item => item.id !== id))
          continue
        }

        setCola(c => c.map(item => item.id === id ? { ...item, estado: 'listo' } : item))
        setFilas(f => [...f, { id, archivo: paginaFile, nombre, datos: resultado, estado: 'pendiente' }])

      } catch (err) {
        console.error(err)
        setCola(c => c.map(item => item.id === id ? { ...item, estado: 'error' } : item))
        setFilas(f => [...f, { id, archivo: file, nombre, datos: null, estado: 'error' }])
      }
    }
  }

  // ── Imagen: procesar directamente ─────────────────────────────────────────
  async function procesarImagen(file) {
    const id = crypto.randomUUID()
    setCola(c => [...c, { id, nombre: file.name, estado: 'procesando' }])
    try {
      const resultado = await llamarEdgeFunction(file)
      setCola(c => c.map(item => item.id === id ? { ...item, estado: 'listo' } : item))
      setFilas(f => [...f, { id, archivo: file, nombre: file.name, datos: resultado, estado: 'pendiente' }])
    } catch (err) {
      console.error(err)
      setCola(c => c.map(item => item.id === id ? { ...item, estado: 'error' } : item))
      setFilas(f => [...f, { id, archivo: file, nombre: file.name, datos: null, estado: 'error' }])
    }
  }

  // ── Llamada a la Edge Function ─────────────────────────────────────────────
  async function llamarEdgeFunction(file) {
    const { data: { session } } = await supabase.auth.getSession()
    const formData = new FormData()
    formData.append('archivo', file)

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/procesar-factura`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: formData,
      }
    )

    if (!response.ok) throw new Error(await response.text())
    return await response.json()
  }

  function editarCampo(id, campo, valor) {
    setFilas(f => f.map(fila => {
      if (fila.id !== id) return fila
      const datos = { ...fila.datos, [campo]: valor }

      // Recalcular cuota y deducible cuando cambia base o % IVA
      if (campo === 'base_imponible' || campo === 'pct_iva') {
        const base = parseFloat(campo === 'base_imponible' ? valor : datos.base_imponible) || 0
        const pct  = parseFloat((campo === 'pct_iva' ? valor : datos.pct_iva)?.toString().replace(',', '.')) || 0
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

      // Recalcular cuota si cambia base o pct_iva de la línea
      if (campo === 'base_imponible' || campo === 'pct_iva') {
        const base = parseFloat(campo === 'base_imponible' ? valor : lineas[idx].base_imponible) || 0
        const pct  = parseFloat((campo === 'pct_iva' ? valor : lineas[idx].pct_iva)?.toString().replace(',', '.')) || 0
        const cuota = Math.round(base * pct / 100 * 100) / 100
        lineas[idx].cuota_iva = cuota.toFixed(2)
        lineas[idx].deducible = cuota.toFixed(2)
      }

      return { ...fila, datos: { ...fila.datos, lineas_extra: lineas } }
    }))
  }

  function setEstadoFila(id, estado) {
    setFilas(f => f.map(fila => fila.id === id ? { ...fila, estado } : fila))
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
          if (str.includes('/')) {
            const [d, m, y] = str.split('/').map(Number)
            return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          }
          return str
        }

        const { datos } = fila
        await supabase.from('facturas').insert({
          cliente_id:       clienteId,
          tipo:             'recibida',
          estado:           'validada',
          num_factura:      datos.num_factura      || null,
          fecha_expedicion: parseDate(datos.fecha_expedicion),
          fecha_operacion:  parseDate(datos.fecha_operacion),
          concepto:         datos.concepto         || null,
          nif_expedidor:    datos.nif_expedidor     || null,
          expedidor:        datos.expedidor         || null,
          base_imponible:   parseFloat(datos.base_imponible)  || 0,
          pct_iva:          datos.pct_iva           || '21,0',
          cuota_iva:        parseFloat(datos.cuota_iva)       || 0,
          deducible:        parseFloat(datos.deducible)       || 0,
          lineas_extra:     datos.lineas_extra      || [],
          archivo_url:      rutaFile,
          archivo_nombre:   fila.nombre,
          ia_raw:           datos,
          ia_confianza:     datos.confianza         || 'media',
        })
      } catch (err) {
        console.error('Error guardando factura:', err)
      }
    }

    setGuardando(false)
    setFilas([])
    setCola([])
    onFacturasGuardadas?.()
  }

  const validadas  = filas.filter(f => f.estado === 'validada').length
  const pendientes = filas.filter(f => f.estado === 'pendiente').length

  return (
    <div>
      <div
        style={{ ...s.dropZone, ...(dragOver ? s.dropZoneActive : {}) }}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        onClick={() => fileInputRef.current.click()}
      >
        <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple style={{ display: 'none' }} onChange={onFileChange} />
        <div style={s.dropIcon}>📄</div>
        <p style={s.dropTitle}>Arrastra facturas aquí</p>
        <p style={s.dropSub}>PDF multipágina, JPG, PNG · Separa automáticamente cada factura</p>
        <button style={s.dropBtn} onClick={e => { e.stopPropagation(); fileInputRef.current.click() }}>Seleccionar archivos</button>
      </div>

      {cola.length > 0 && (
        <div style={s.colaSection}>
          <p style={s.sectionLabel}>Procesando {cola.length} página{cola.length !== 1 ? 's' : ''}…</p>
          {cola.map(item => (
            <div key={item.id} style={s.colaItem}>
              <span style={s.colaIcon}>📋</span>
              <span style={s.colaNombre}>{item.nombre}</span>
              <span style={{ ...s.colaBadge, ...estadoStyle(item.estado) }}>
                {item.estado === 'procesando' ? '⟳ Leyendo…' : item.estado === 'listo' ? '✓ Listo' : '✗ Error'}
              </span>
            </div>
          ))}
        </div>
      )}

      {filas.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <div style={s.tablaHeader}>
            <div>
              <p style={s.sectionLabel}>Revisar y validar</p>
              <p style={s.tablaStats}>
                <span style={{ color: '#2E7D32' }}>{validadas} validadas</span>
                {' · '}
                <span style={{ color: '#F57F17' }}>{pendientes} pendientes</span>
              </p>
            </div>
            <button onClick={guardarValidadas} disabled={validadas === 0 || guardando} style={{ ...s.btnGuardar, opacity: validadas === 0 ? 0.4 : 1 }}>
              {guardando ? 'Guardando…' : `⬆ Guardar ${validadas} factura${validadas !== 1 ? 's' : ''}`}
            </button>
          </div>
          <div style={s.tableWrap}>
            {filas.map(fila => (
              <FilaFactura
                key={fila.id} fila={fila}
                onChange={(campo, valor) => editarCampo(fila.id, campo, valor)}
                onChangeLinea={(idx, campo, valor) => editarLineaExtra(fila.id, idx, campo, valor)}
                onValidar={() => setEstadoFila(fila.id, 'validada')}
                onError={()   => setEstadoFila(fila.id, 'error')}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FilaFactura({ fila, onChange, onChangeLinea, onValidar, onError }) {
  const { datos, nombre, estado, archivo } = fila
  
  // Truncar número de factura a últimos 10 chars si es necesario
  const numFacturaMostrado = datos.num_factura || ''
  const numFacturaA3 = numFacturaMostrado.length > 10 
    ? numFacturaMostrado.slice(-10) 
    : numFacturaMostrado
  const numTruncado = numFacturaMostrado.length > 10
  const [preview, setPreview] = useState(null)

  if (!datos) return (
    <div style={s.filaError}>✗ No se pudo leer <strong>{nombre}</strong> — revisión manual necesaria</div>
  )
  const confColor  = { alta: '#2E7D32', media: '#F57F17', baja: '#E65100' }[datos.confianza] || '#6B6B6B'
  const isValidada = estado === 'validada'
  const total      = ((parseFloat(datos.base_imponible)||0) + (parseFloat(datos.cuota_iva)||0)).toFixed(2)

  function verFactura() { setPreview(URL.createObjectURL(archivo)) }
  function cerrarPreview() { if (preview) URL.revokeObjectURL(preview); setPreview(null) }

  return (
    <>
      <div style={{ ...s.filaCard, ...(isValidada ? s.filaValidada : {}) }}>
        <div style={s.filaTop}>
          <span style={s.filaNombre}>📄 {nombre}</span>
          <span style={{ ...s.confBadge, color: confColor }}>● Confianza {datos.confianza}</span>
          {datos.notas && <span style={s.filaNota} title={datos.notas}>⚠ nota</span>}
        </div>
        <div style={s.filaGrid}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={s.campoLabel}>Nº Factura {numTruncado && <span style={{ color: '#E65100', fontWeight: 700 }}>→ A3: {numFacturaA3}</span>}</label>
            <input type="text" value={numFacturaMostrado} onChange={e => onChange('num_factura', e.target.value)}
              style={{ ...s.campoInput, fontFamily: 'monospace', fontSize: '0.8rem', ...(numTruncado ? { borderColor: '#FFCC80' } : {}) }} />
          </div>
          <Campo label="Expedidor"   value={datos.expedidor}        onChange={v => onChange('expedidor', v)}      wide />
          <Campo label="NIF / CIF"   value={datos.nif_expedidor}    onChange={v => onChange('nif_expedidor', v)}  mono />
          <Campo label="Fecha"       value={datos.fecha_expedicion} onChange={v => onChange('fecha_expedicion', v)} small />
          <Campo label="Concepto"    value={datos.concepto}         onChange={v => onChange('concepto', v)}       wide />
          <Campo label="Base Imp."   value={datos.base_imponible}   onChange={v => onChange('base_imponible', v)} small right />
          <Campo label="% IVA"       value={datos.pct_iva}          onChange={v => onChange('pct_iva', v)}        small right />
          <Campo label="Cuota IVA"   value={datos.cuota_iva}        onChange={v => onChange('cuota_iva', v)}      small right />
          <Campo label="Deducible"   value={datos.deducible}        onChange={v => onChange('deducible', v)}      small right />
          <Campo label="Total"       value={total}                  onChange={() => {}}                           small right />
        </div>
        {/* Líneas extra de IVA — editables */}
        {datos.lineas_extra?.length > 0 && (
          <div style={s.lineasExtra}>
            <p style={s.lineasLabel}>Líneas adicionales de IVA</p>
            {datos.lineas_extra.map((linea, idx) => (
              <div key={idx} style={s.lineaRowEdit}>
                <span style={s.lineaTag}>IVA {linea.pct_iva}%</span>
                <div style={s.lineaInputGroup}>
                  <label style={s.campoLabel}>Base</label>
                  <input type="text" value={linea.base_imponible ?? ''} onChange={e => onChangeLinea(idx, 'base_imponible', e.target.value)}
                    style={{ ...s.campoInput, width: '90px', textAlign: 'right' }} />
                </div>
                <div style={s.lineaInputGroup}>
                  <label style={s.campoLabel}>% IVA</label>
                  <input type="text" value={linea.pct_iva ?? ''} onChange={e => onChangeLinea(idx, 'pct_iva', e.target.value)}
                    style={{ ...s.campoInput, width: '60px', textAlign: 'right' }} />
                </div>
                <div style={s.lineaInputGroup}>
                  <label style={s.campoLabel}>Cuota</label>
                  <input type="text" value={linea.cuota_iva ?? ''} onChange={e => onChangeLinea(idx, 'cuota_iva', e.target.value)}
                    style={{ ...s.campoInput, width: '90px', textAlign: 'right' }} />
                </div>
                <div style={s.lineaInputGroup}>
                  <label style={s.campoLabel}>Deducible</label>
                  <input type="text" value={linea.deducible ?? ''} onChange={e => onChangeLinea(idx, 'deducible', e.target.value)}
                    style={{ ...s.campoInput, width: '90px', textAlign: 'right' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {datos.tipo === 'abono' && (
          <div style={s.abonoBadge}>⚠ Factura rectificativa / Abono — importes negativos</div>
        )}

        <div style={s.filaActions}>
          <button onClick={onValidar} style={{ ...s.btnOk, ...(isValidada ? s.btnOkActive : {}) }}>
            ✓ {isValidada ? 'Validada' : 'Validar'}
          </button>
          <button onClick={onError} style={{ ...s.btnErr, ...(estado === 'error' ? s.btnErrActive : {}) }}>
            ✗ Error
          </button>
          <button onClick={verFactura} style={s.btnVer}>
            🔍 Ver factura
          </button>
        </div>
      </div>

      {preview && (
        <div style={s.overlay} onClick={cerrarPreview}>
          <div style={s.previewModal} onClick={e => e.stopPropagation()}>
            <div style={s.previewHeader}>
              <span style={s.previewNombre}>📄 {nombre}</span>
              <button onClick={cerrarPreview} style={s.previewClose}>✕ Cerrar</button>
            </div>
            {archivo.type === 'application/pdf' ? (
              <iframe src={preview} style={s.previewFrame} title="Vista previa" />
            ) : (
              <img src={preview} alt="Vista previa" style={s.previewImg} />
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Campo({ label, value, onChange, mono, wide, small, right }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', ...(wide ? { gridColumn: 'span 2' } : {}) }}>
      <label style={s.campoLabel}>{label}</label>
      <input
        type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
        style={{ ...s.campoInput, ...(mono ? { fontFamily: 'monospace', fontSize: '0.8rem' } : {}), ...(right ? { textAlign: 'right' } : {}), ...(small ? { width: '100px' } : {}) }}
      />
    </div>
  )
}

function estadoStyle(estado) {
  if (estado === 'procesando') return { background: '#FFF8E1', color: '#F57F17' }
  if (estado === 'listo')      return { background: '#E8F5E9', color: '#2E7D32' }
  return { background: '#FFF3E0', color: '#E65100' }
}

const s = {
  dropZone:      { border: '2px dashed #D8D4CB', borderRadius: '10px', background: '#fff', padding: '48px 24px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' },
  dropZoneActive:{ borderColor: '#1A472A', background: '#E8F5E9' },
  dropIcon:      { fontSize: '2.5rem', marginBottom: '10px' },
  dropTitle:     { fontWeight: 700, fontSize: '1rem', marginBottom: '6px' },
  dropSub:       { fontSize: '0.82rem', color: '#6B6B6B', marginBottom: '14px' },
  dropBtn:       { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  colaSection:   { marginTop: '20px' },
  sectionLabel:  { fontSize: '0.75rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' },
  colaItem:      { background: '#fff', border: '1px solid #D8D4CB', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' },
  colaIcon:      { fontSize: '1.2rem' },
  colaNombre:    { flex: 1, fontSize: '0.88rem', fontWeight: 500 },
  colaBadge:     { fontSize: '0.75rem', padding: '3px 10px', borderRadius: '20px', fontWeight: 600 },
  tablaHeader:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' },
  tablaStats:    { fontSize: '0.82rem', marginTop: '4px' },
  btnGuardar:    { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },
  tableWrap:     { display: 'flex', flexDirection: 'column', gap: '10px' },
  filaCard:      { background: '#fff', border: '1px solid #D8D4CB', borderRadius: '10px', padding: '16px' },
  filaValidada:  { borderColor: '#A5D6A7', background: '#FAFFF8' },
  filaError:     { background: '#FFF3E0', border: '1px solid #FFCC80', borderRadius: '10px', padding: '14px 16px', color: '#E65100', fontSize: '0.88rem' },
  filaTop:       { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' },
  filaNombre:    { flex: 1, fontSize: '0.85rem', fontWeight: 600, color: '#6B6B6B' },
  confBadge:     { fontSize: '0.75rem', fontWeight: 600 },
  filaNota:      { fontSize: '0.75rem', color: '#E65100', cursor: 'help' },
  filaGrid:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', marginBottom: '14px' },
  campoLabel:    { fontSize: '0.72rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.5px' },
  campoInput:    { padding: '7px 9px', border: '1px solid #D8D4CB', borderRadius: '6px', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit', width: '100%' },
  filaActions:   { display: 'flex', gap: '8px' },
  btnOk:         { background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7', borderRadius: '6px', padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' },
  btnOkActive:   { background: '#2E7D32', color: '#fff', borderColor: '#2E7D32' },
  btnErr:        { background: '#FFF3E0', color: '#E65100', border: '1px solid #FFCC80', borderRadius: '6px', padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' },
  btnErrActive:  { background: '#E65100', color: '#fff', borderColor: '#E65100' },
  btnVer:        { background: '#F5F3EE', color: '#1C1C1C', border: '1px solid #D8D4CB', borderRadius: '6px', padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' },
  overlay:       { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' },
  previewModal:  { background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '860px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  previewHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #D8D4CB' },
  previewNombre: { fontSize: '0.88rem', fontWeight: 600, color: '#1C1C1C' },
  previewClose:  { background: 'transparent', border: 'none', fontSize: '0.85rem', cursor: 'pointer', color: '#6B6B6B', fontWeight: 600 },
  previewFrame:  { width: '100%', flex: 1, border: 'none', minHeight: '70vh' },
  previewImg:    { width: '100%', maxHeight: '75vh', objectFit: 'contain', padding: '16px' },
  lineasExtra:    { background: '#F5F3EE', border: '1px solid #D8D4CB', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px' },
  lineasLabel:    { fontSize: '0.72rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' },
  lineaRowEdit:   { display: 'flex', gap: '10px', alignItems: 'flex-end', padding: '6px 0', borderBottom: '1px solid #EDEAE3' },
  lineaTag:       { background: '#1A472A', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0, marginBottom: '6px' },
  lineaInputGroup:{ display: 'flex', flexDirection: 'column', gap: '3px' },
  abonoBadge:    { background: '#FFF3E0', border: '1px solid #FFCC80', borderRadius: '6px', padding: '8px 12px', fontSize: '0.82rem', color: '#E65100', fontWeight: 600, marginBottom: '10px' },
}
