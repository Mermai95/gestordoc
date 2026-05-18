import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { PDFDocument } from 'pdf-lib'

export default function SubirFacturas({ clienteId, onFacturasGuardadas }) {
  const { user }     = useAuth()
  const fileInputRef = useRef()
  const [dragOver,   setDragOver]   = useState(false)
  const [cola,       setCola]       = useState([])
  const [filas,      setFilas]      = useState([])
  const [seleccionId, setSeleccionId] = useState(null)
  const [guardando,  setGuardando]  = useState(false)

  const filaSeleccionada = filas.find(f => f.id === seleccionId) || filas[0] || null

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
    if (file.type === 'application/pdf') await procesarPDF(file)
    else await procesarImagen(file)
  }

  async function procesarPDF(file) {
    const buffer   = await file.arrayBuffer()
    const pdfDoc   = await PDFDocument.load(buffer)
    const numPages = pdfDoc.getPageCount()

    for (let i = 0; i < numPages; i++) {
      const id     = crypto.randomUUID()
      const nombre = numPages === 1 ? file.name : `${file.name} — pág. ${i + 1}/${numPages}`
      setCola(c => [...c, { id, nombre, estado: 'procesando' }])

      try {
        const paginaDoc   = await PDFDocument.create()
        const [pagina]    = await paginaDoc.copyPages(pdfDoc, [i])
        paginaDoc.addPage(pagina)
        const paginaBytes = await paginaDoc.save()
        const paginaBlob  = new Blob([paginaBytes], { type: 'application/pdf' })
        const paginaFile  = new File([paginaBlob], `pagina_${i+1}.pdf`, { type: 'application/pdf' })
        const resultado   = await llamarEdgeFunction(paginaFile)

        if (resultado?.es_factura === false) {
          setCola(c => c.filter(item => item.id !== id))
          continue
        }

        setCola(c => c.map(item => item.id === id ? { ...item, estado: 'listo' } : item))
        setFilas(f => {
          const nuevas = [...f, { id, archivo: paginaFile, nombre, datos: resultado, estado: 'pendiente', previewUrl: URL.createObjectURL(paginaBlob) }]
          if (f.length === 0) setSeleccionId(id)
          return nuevas
        })
      } catch (err) {
        console.error(err)
        setCola(c => c.map(item => item.id === id ? { ...item, estado: 'error' } : item))
        setFilas(f => [...f, { id, archivo: file, nombre, datos: null, estado: 'error', previewUrl: null }])
      }
    }
  }

  async function procesarImagen(file) {
    const id = crypto.randomUUID()
    setCola(c => [...c, { id, nombre: file.name, estado: 'procesando' }])
    try {
      const resultado = await llamarEdgeFunction(file)
      setCola(c => c.map(item => item.id === id ? { ...item, estado: 'listo' } : item))
      setFilas(f => {
        const nuevas = [...f, { id, archivo: file, nombre: file.name, datos: resultado, estado: 'pendiente', previewUrl: URL.createObjectURL(file) }]
        if (f.length === 0) setSeleccionId(id)
        return nuevas
      })
    } catch (err) {
      console.error(err)
      setCola(c => c.map(item => item.id === id ? { ...item, estado: 'error' } : item))
      setFilas(f => [...f, { id, archivo: file, nombre: file.name, datos: null, estado: 'error', previewUrl: null }])
    }
  }

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
          cliente_id: clienteId, tipo: 'recibida', estado: 'validada',
          num_factura: datos.num_factura || null,
          fecha_expedicion: parseDate(datos.fecha_expedicion),
          fecha_operacion:  parseDate(datos.fecha_operacion),
          concepto: datos.concepto || null,
          nif_expedidor: datos.nif_expedidor || null,
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
    // Limpiar preview URLs
    filas.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl) })
    setGuardando(false)
    setFilas([])
    setCola([])
    setSeleccionId(null)
    onFacturasGuardadas?.()
  }

  const validadas  = filas.filter(f => f.estado === 'validada').length
  const pendientes = filas.filter(f => f.estado === 'pendiente').length

  // ── Sin facturas aún — mostrar drop zone ──────────────────────────────────
  if (filas.length === 0 && cola.length === 0) {
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
      </div>
    )
  }

  // ── Layout visor tipo A3 Scan ──────────────────────────────────────────────
  return (
    <div style={s.visorShell}>

      {/* COLUMNA IZQUIERDA — lista de facturas */}
      <div style={s.listaCol}>
        <div style={s.listaHeader}>
          <span style={s.listaTitle}>Facturas ({filas.length})</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple style={{ display: 'none' }} onChange={onFileChange} />
            <button onClick={() => fileInputRef.current.click()} style={s.btnAnadir}>+ Añadir</button>
          </div>
        </div>

        {/* Cola procesando */}
        {cola.filter(c => c.estado === 'procesando').map(item => (
          <div key={item.id} style={s.colaItem}>
            <span style={s.colaSpinner}>⟳</span>
            <span style={s.colaNombre}>{item.nombre}</span>
          </div>
        ))}

        {/* Lista de facturas procesadas */}
        <div style={s.listaScroll}>
          {filas.map(fila => {
            const isSelected = fila.id === (filaSeleccionada?.id)
            const confColor  = { alta: '#2E7D32', media: '#F57F17', baja: '#E65100' }[fila.datos?.confianza] || '#6B6B6B'
            return (
              <div
                key={fila.id}
                onClick={() => setSeleccionId(fila.id)}
                style={{ ...s.listaItem, ...(isSelected ? s.listaItemSelected : {}) }}
              >
                <div style={s.listaItemTop}>
                  <span style={s.listaItemNum}>{fila.datos?.num_factura || '—'}</span>
                  <EstadoBadgeMini estado={fila.estado} />
                </div>
                <div style={s.listaItemExp}>{fila.datos?.expedidor || fila.nombre}</div>
                <div style={s.listaItemBottom}>
                  <span style={s.listaItemFecha}>{fila.datos?.fecha_expedicion || ''}</span>
                  <span style={s.listaItemImporte}>
                    {fila.datos ? `${(parseFloat(fila.datos.base_imponible||0) + parseFloat(fila.datos.cuota_iva||0)).toFixed(2)} €` : '—'}
                  </span>
                  <span style={{ ...s.confDot, color: confColor }}>●</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer con botón guardar */}
        <div style={s.listaFooter}>
          <div style={s.statsRow}>
            <span style={{ color: '#2E7D32', fontSize: '0.78rem', fontWeight: 600 }}>{validadas} ✓</span>
            <span style={{ color: '#F57F17', fontSize: '0.78rem' }}>{pendientes} pendientes</span>
          </div>
          <button
            onClick={guardarValidadas}
            disabled={validadas === 0 || guardando}
            style={{ ...s.btnGuardar, opacity: validadas === 0 ? 0.4 : 1 }}
          >
            {guardando ? 'Guardando…' : `⬆ Guardar ${validadas}`}
          </button>
        </div>
      </div>

      {/* COLUMNA CENTRO — visor de la factura seleccionada */}
      <div style={s.visorCol}>
        {filaSeleccionada?.previewUrl ? (
          filaSeleccionada.archivo?.type === 'application/pdf' ? (
            <iframe src={filaSeleccionada.previewUrl} style={s.visorFrame} title="Vista previa" />
          ) : (
            <div style={s.visorImgWrap}>
              <img src={filaSeleccionada.previewUrl} alt="Factura" style={s.visorImg} />
            </div>
          )
        ) : (
          <div style={s.visorEmpty}>
            <span style={{ fontSize: '3rem' }}>📄</span>
            <p style={{ color: '#6B6B6B', marginTop: '12px' }}>Selecciona una factura</p>
          </div>
        )}
      </div>

      {/* COLUMNA DERECHA — campos editables */}
      <div style={s.editCol}>
        {filaSeleccionada && filaSeleccionada.datos ? (
          <EditorFactura
            fila={filaSeleccionada}
            onChange={(campo, valor) => editarCampo(filaSeleccionada.id, campo, valor)}
            onChangeLinea={(idx, campo, valor) => editarLineaExtra(filaSeleccionada.id, idx, campo, valor)}
            onValidar={() => setEstadoFila(filaSeleccionada.id, 'validada')}
            onError={()   => setEstadoFila(filaSeleccionada.id, 'error')}
          />
        ) : filaSeleccionada ? (
          <div style={s.visorEmpty}>
            <p style={{ color: '#E65100' }}>✗ No se pudo leer esta factura</p>
            <p style={{ color: '#6B6B6B', fontSize: '0.82rem', marginTop: '8px' }}>Revisión manual necesaria</p>
          </div>
        ) : (
          <div style={s.visorEmpty}>
            <p style={{ color: '#6B6B6B' }}>Selecciona una factura de la lista</p>
          </div>
        )}
      </div>

    </div>
  )
}

// ── Editor de factura (columna derecha) ───────────────────────────────────────
function EditorFactura({ fila, onChange, onChangeLinea, onValidar, onError }) {
  const { datos, estado } = fila
  const isValidada = estado === 'validada'
  const confColor  = { alta: '#2E7D32', media: '#F57F17', baja: '#E65100' }[datos.confianza] || '#6B6B6B'
  const total      = ((parseFloat(datos.base_imponible)||0) + (parseFloat(datos.cuota_iva)||0)).toFixed(2)

  const numFacturaMostrado = datos.num_factura || ''
  const numFacturaA3       = numFacturaMostrado.length > 10 ? numFacturaMostrado.slice(-10) : numFacturaMostrado
  const numTruncado        = numFacturaMostrado.length > 10

  return (
    <div style={s.editorWrap}>
      {/* Cabecera estado */}
      <div style={s.editorHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ ...s.confDot, color: confColor, fontSize: '0.85rem' }}>● Confianza {datos.confianza}</span>
          {datos.tipo === 'abono' && <span style={s.abonoBadge}>ABONO</span>}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={onValidar} style={{ ...s.btnOk, ...(isValidada ? s.btnOkActive : {}) }}>
            ✓ {isValidada ? 'Validada' : 'Validar'}
          </button>
          <button onClick={onError} style={s.btnErr}>✗</button>
        </div>
      </div>

      {/* Campos editables */}
      <div style={s.editorBody}>
        {/* Nº Factura con aviso truncado */}
        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>
            Nº Factura
            {numTruncado && <span style={{ color: '#E65100', marginLeft: '6px' }}>→ A3: {numFacturaA3}</span>}
          </label>
          <input type="text" value={numFacturaMostrado} onChange={e => onChange('num_factura', e.target.value)}
            style={{ ...s.fieldInput, fontFamily: 'monospace', ...(numTruncado ? { borderColor: '#FFCC80' } : {}) }} />
        </div>

        <Campo2 label="Expedidor"     value={datos.expedidor}        onChange={v => onChange('expedidor', v)} />
        <Campo2 label="NIF / CIF"     value={datos.nif_expedidor}    onChange={v => onChange('nif_expedidor', v)} mono />
        <Campo2 label="Fecha"         value={datos.fecha_expedicion} onChange={v => onChange('fecha_expedicion', v)} />
        <Campo2 label="F. Operación"  value={datos.fecha_operacion}  onChange={v => onChange('fecha_operacion', v)} />
        <Campo2 label="Concepto"      value={datos.concepto}         onChange={v => onChange('concepto', v)} />

        <div style={s.divider} />

        <div style={s.importesGrid}>
          <Campo2 label="Base Imp."  value={datos.base_imponible} onChange={v => onChange('base_imponible', v)} right />
          <Campo2 label="% IVA"      value={datos.pct_iva}        onChange={v => onChange('pct_iva', v)} right />
          <Campo2 label="Cuota IVA"  value={datos.cuota_iva}      onChange={v => onChange('cuota_iva', v)} right />
          <Campo2 label="Deducible"  value={datos.deducible}      onChange={v => onChange('deducible', v)} right />
        </div>

        {/* Total calculado */}
        <div style={s.totalRow}>
          <span style={s.totalLabel}>Total factura</span>
          <span style={s.totalValor}>{total} €</span>
        </div>

        {/* Líneas extra IVA */}
        {datos.lineas_extra?.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <p style={s.fieldLabel}>Líneas adicionales de IVA</p>
            {datos.lineas_extra.map((linea, idx) => (
              <div key={idx} style={s.lineaExtraEdit}>
                <span style={s.lineaTag}>IVA {linea.pct_iva}%</span>
                <div style={s.importesGrid}>
                  <Campo2 label="Base"     value={linea.base_imponible} onChange={v => onChangeLinea(idx, 'base_imponible', v)} right />
                  <Campo2 label="% IVA"    value={linea.pct_iva}        onChange={v => onChangeLinea(idx, 'pct_iva', v)} right />
                  <Campo2 label="Cuota"    value={linea.cuota_iva}      onChange={v => onChangeLinea(idx, 'cuota_iva', v)} right />
                  <Campo2 label="Deducible" value={linea.deducible}     onChange={v => onChangeLinea(idx, 'deducible', v)} right />
                </div>
              </div>
            ))}
          </div>
        )}

        {datos.notas && (
          <div style={s.notasBox}>⚠ {datos.notas}</div>
        )}
      </div>
    </div>
  )
}

function Campo2({ label, value, onChange, mono, right }) {
  return (
    <div style={s.fieldGroup}>
      <label style={s.fieldLabel}>{label}</label>
      <input
        type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
        style={{ ...s.fieldInput, ...(mono ? { fontFamily: 'monospace' } : {}), ...(right ? { textAlign: 'right' } : {}) }}
      />
    </div>
  )
}

function EstadoBadgeMini({ estado }) {
  const map = {
    validada:  { bg: '#E8F5E9', color: '#2E7D32', label: '✓' },
    pendiente: { bg: '#FFF8E1', color: '#F57F17', label: '·' },
    error:     { bg: '#FFF3E0', color: '#E65100', label: '✗' },
  }
  const st = map[estado] || map.pendiente
  return <span style={{ background: st.bg, color: st.color, padding: '1px 6px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700 }}>{st.label}</span>
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const s = {
  // Drop zone
  dropZone:       { border: '2px dashed #D8D4CB', borderRadius: '10px', background: '#fff', padding: '48px 24px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' },
  dropZoneActive: { borderColor: '#1A472A', background: '#E8F5E9' },
  dropIcon:       { fontSize: '2.5rem', marginBottom: '10px' },
  dropTitle:      { fontWeight: 700, fontSize: '1rem', marginBottom: '6px' },
  dropSub:        { fontSize: '0.82rem', color: '#6B6B6B', marginBottom: '14px' },
  dropBtn:        { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' },

  // Layout visor
  visorShell:     { display: 'grid', gridTemplateColumns: '260px 1fr 300px', gap: '0', height: 'calc(100vh - 180px)', background: '#fff', border: '1px solid #D8D4CB', borderRadius: '10px', overflow: 'hidden' },

  // Columna izquierda — lista
  listaCol:       { display: 'flex', flexDirection: 'column', borderRight: '1px solid #D8D4CB', background: '#F5F3EE' },
  listaHeader:    { padding: '12px 14px', borderBottom: '1px solid #D8D4CB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' },
  listaTitle:     { fontSize: '0.82rem', fontWeight: 700, color: '#1C1C1C' },
  listaScroll:    { flex: 1, overflowY: 'auto' },
  listaItem:      { padding: '10px 14px', borderBottom: '1px solid #EDEAE3', cursor: 'pointer', transition: 'background 0.1s' },
  listaItemSelected: { background: '#E8F5E9', borderLeft: '3px solid #1A472A' },
  listaItemTop:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' },
  listaItemNum:   { fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 700, color: '#1C1C1C' },
  listaItemExp:   { fontSize: '0.78rem', color: '#1C1C1C', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  listaItemBottom:{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  listaItemFecha: { fontSize: '0.72rem', color: '#6B6B6B' },
  listaItemImporte:{ fontSize: '0.78rem', fontWeight: 600, color: '#1A472A' },
  listaFooter:    { padding: '10px 14px', borderTop: '1px solid #D8D4CB', background: '#fff', display: 'flex', flexDirection: 'column', gap: '8px' },
  statsRow:       { display: 'flex', gap: '10px' },
  btnGuardar:     { background: '#1A472A', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', width: '100%' },
  btnAnadir:      { background: 'transparent', border: '1px solid #D8D4CB', borderRadius: '6px', padding: '4px 10px', fontSize: '0.75rem', cursor: 'pointer', color: '#1C1C1C' },
  colaItem:       { padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px', background: '#FFF8E1', borderBottom: '1px solid #EDEAE3' },
  colaSpinner:    { fontSize: '0.9rem', color: '#F57F17', animation: 'spin 1s linear infinite' },
  colaNombre:     { fontSize: '0.75rem', color: '#6B6B6B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },

  // Columna centro — visor
  visorCol:       { display: 'flex', flexDirection: 'column', background: '#2C2C2C', overflow: 'hidden' },
  visorFrame:     { width: '100%', height: '100%', border: 'none' },
  visorImgWrap:   { flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px' },
  visorImg:       { maxWidth: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' },
  visorEmpty:     { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6B6B6B' },

  // Columna derecha — editor
  editCol:        { borderLeft: '1px solid #D8D4CB', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  editorWrap:     { display: 'flex', flexDirection: 'column', height: '100%' },
  editorHeader:   { padding: '12px 14px', borderBottom: '1px solid #D8D4CB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', flexShrink: 0 },
  editorBody:     { flex: 1, overflowY: 'auto', padding: '14px' },
  fieldGroup:     { marginBottom: '10px' },
  fieldLabel:     { display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' },
  fieldInput:     { width: '100%', padding: '7px 9px', border: '1px solid #D8D4CB', borderRadius: '6px', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  divider:        { borderTop: '1px solid #EDEAE3', margin: '12px 0' },
  importesGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
  totalRow:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#E8F5E9', borderRadius: '6px', padding: '8px 12px', marginTop: '10px' },
  totalLabel:     { fontSize: '0.78rem', fontWeight: 600, color: '#1A472A' },
  totalValor:     { fontSize: '1rem', fontWeight: 700, color: '#1A472A' },
  lineaExtraEdit: { background: '#F5F3EE', borderRadius: '6px', padding: '8px', marginBottom: '8px' },
  lineaTag:       { display: 'inline-block', background: '#1A472A', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, marginBottom: '8px' },
  notasBox:       { background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '6px', padding: '8px 10px', fontSize: '0.78rem', color: '#F57F17', marginTop: '12px' },
  abonoBadge:     { background: '#FFF3E0', color: '#E65100', border: '1px solid #FFCC80', borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700 },
  confDot:        { fontSize: '0.75rem', fontWeight: 600 },
  btnOk:          { background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7', borderRadius: '6px', padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  btnOkActive:    { background: '#2E7D32', color: '#fff', borderColor: '#2E7D32' },
  btnErr:         { background: '#FFF3E0', color: '#E65100', border: '1px solid #FFCC80', borderRadius: '6px', padding: '5px 10px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
}
