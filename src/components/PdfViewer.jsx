import { useEffect, useRef, useState, useCallback } from 'react'

export default function PdfViewer({ url }) {
  const containerRef  = useRef(null)
  const canvasRef     = useRef(null)
  const pdfRef        = useRef(null)
  const scaleRef      = useRef(0.8)          // zoom inicial — factura visible completa
  const offsetRef     = useRef({ x: 0, y: 0 })
  const draggingRef   = useRef(false)
  const lastPosRef    = useRef({ x: 0, y: 0 })
  const pageRef       = useRef(null)
  const renderingRef  = useRef(false)
  const pendingRef    = useRef(false)

  const [pagina,      setPagina]    = useState(1)
  const [totalPags,   setTotalPags] = useState(1)
  const [cargando,    setCargando]  = useState(true)
  const [error,       setError]     = useState(null)
  const paginaRef     = useRef(1)

  // Renderiza la página actual con el scale y offset actuales
  const renderizar = useCallback(async () => {
    if (!pageRef.current || !canvasRef.current) return
    if (renderingRef.current) { pendingRef.current = true; return }
    renderingRef.current = true

    const canvas  = canvasRef.current
    const ctx     = canvas.getContext('2d')
    const page    = pageRef.current
    const scale   = scaleRef.current
    const vp      = page.getViewport({ scale })

    canvas.width  = vp.width
    canvas.height = vp.height

    try {
      await page.render({ canvasContext: ctx, viewport: vp }).promise
    } catch (e) {
      // render cancelado, no pasa nada
    }

    renderingRef.current = false
    if (pendingRef.current) { pendingRef.current = false; renderizar() }
  }, [])

  // Carga el PDF y la página
  const cargarPagina = useCallback(async (pdf, num) => {
    setCargando(true)
    const page = await pdf.getPage(num)
    pageRef.current = page
    // Calcular escala inicial para que quepa en el contenedor
    const container = containerRef.current
    if (container) {
      const vp = page.getViewport({ scale: 1 })
      const fitScale = (container.clientHeight - 40) / vp.height
      scaleRef.current = Math.min(fitScale, 0.9)
    }
    offsetRef.current = { x: 0, y: 0 }
    await renderizar()
    setCargando(false)
  }, [renderizar])

  // Cargar PDF cuando cambia la URL
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setCargando(true)
    setError(null)

    async function cargar() {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString()

        const pdf = await pdfjsLib.getDocument(url).promise
        if (cancelled) return
        pdfRef.current = pdf
        setTotalPags(pdf.numPages)
        setPagina(1)
        paginaRef.current = 1
        await cargarPagina(pdf, 1)
      } catch (e) {
        if (!cancelled) setError('No se pudo cargar el PDF')
      }
    }
    cargar()
    return () => { cancelled = true }
  }, [url, cargarPagina])

  // Cambio de página
  useEffect(() => {
    if (!pdfRef.current) return
    paginaRef.current = pagina
    cargarPagina(pdfRef.current, pagina)
  }, [pagina, cargarPagina])

  // ── Zoom con rueda ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function onWheel(e) {
      e.preventDefault()
      const delta    = e.deltaY > 0 ? -0.1 : 0.1
      const newScale = Math.max(0.3, Math.min(5, scaleRef.current + delta))

      // Zoom centrado en la posición del cursor sobre el canvas
      const canvas = canvasRef.current
      if (canvas) {
        const rect    = canvas.getBoundingClientRect()
        const mouseX  = e.clientX - rect.left
        const mouseY  = e.clientY - rect.top
        const factor  = newScale / scaleRef.current
        offsetRef.current = {
          x: mouseX - factor * (mouseX - offsetRef.current.x),
          y: mouseY - factor * (mouseY - offsetRef.current.y),
        }
      }

      scaleRef.current = newScale
      renderizar()
      aplicarTransform()
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [renderizar])

  // ── Pan con arrastre ────────────────────────────────────────────────────────
  function onMouseDown(e) {
    if (e.button !== 0) return
    draggingRef.current = true
    lastPosRef.current  = { x: e.clientX, y: e.clientY }
    e.currentTarget.style.cursor = 'grabbing'
  }

  function onMouseMove(e) {
    if (!draggingRef.current) return
    const dx = e.clientX - lastPosRef.current.x
    const dy = e.clientY - lastPosRef.current.y
    offsetRef.current = {
      x: offsetRef.current.x + dx,
      y: offsetRef.current.y + dy,
    }
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    aplicarTransform()
  }

  function onMouseUp(e) {
    draggingRef.current = false
    if (e.currentTarget) e.currentTarget.style.cursor = 'grab'
  }

  function aplicarTransform() {
    if (!canvasRef.current) return
    const { x, y } = offsetRef.current
    canvasRef.current.style.transform       = `translate(${x}px, ${y}px)`
    canvasRef.current.style.transformOrigin = '0 0'
  }

  function resetZoom() {
    if (!pageRef.current || !containerRef.current) return
    const vp       = pageRef.current.getViewport({ scale: 1 })
    const fitScale = (containerRef.current.clientHeight - 40) / vp.height
    scaleRef.current  = Math.min(fitScale, 0.9)
    offsetRef.current = { x: 0, y: 0 }
    renderizar()
    aplicarTransform()
  }

  if (!url) return (
    <div style={s.empty}>
      <div style={{ fontSize: '2.5rem', opacity: 0.2, marginBottom: '8px' }}>📄</div>
      <span>Sin documento adjunto</span>
    </div>
  )

  return (
    <div style={s.wrapper}>
      {/* Header con controles */}
      <div style={s.header}>
        <span style={s.headerLabel}>📄 Documento original</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {totalPags > 1 && (
            <div style={s.pagControls}>
              <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1} style={s.pagBtn}>‹</button>
              <span style={s.pagInfo}>{pagina} / {totalPags}</span>
              <button onClick={() => setPagina(p => Math.min(totalPags, p + 1))} disabled={pagina === totalPags} style={s.pagBtn}>›</button>
            </div>
          )}
          <button onClick={resetZoom} style={s.zoomBtn} title="Restablecer zoom">⊡ Reset</button>
        </div>
      </div>

      {/* Área de visualización */}
      <div
        ref={containerRef}
        style={s.viewport}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {cargando && (
          <div style={s.loading}>
            <span style={{ fontSize: '1.4rem' }}>⟳</span>
            <span style={{ fontSize: '0.82rem' }}>Cargando…</span>
          </div>
        )}
        {error && (
          <div style={s.errorBox}>{error}</div>
        )}
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0, left: 0,
            cursor: 'grab',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            display: cargando ? 'none' : 'block',
          }}
        />
      </div>

      <div style={s.hint}>🖱 Rueda para zoom · Arrastrar para mover</div>
    </div>
  )
}

const s = {
  wrapper:   { display: 'flex', flexDirection: 'column', height: '100%', background: '#2A2A2A' },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#3A3A3A', borderBottom: '1px solid #555', flexShrink: 0 },
  headerLabel:{ color: '#ccc', fontSize: '0.75rem', fontWeight: 600 },
  pagControls:{ display: 'flex', alignItems: 'center', gap: '4px' },
  pagBtn:    { background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '1rem', cursor: 'pointer', lineHeight: 1 },
  pagInfo:   { color: '#ccc', fontSize: '0.75rem', minWidth: '40px', textAlign: 'center' },
  zoomBtn:   { background: 'rgba(255,255,255,0.1)', color: '#ccc', border: 'none', borderRadius: '4px', padding: '4px 9px', fontSize: '0.72rem', cursor: 'pointer' },
  viewport:  { flex: 1, position: 'relative', overflow: 'hidden', cursor: 'grab' },
  loading:   { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', gap: '8px' },
  errorBox:  { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E2401B', fontSize: '0.85rem' },
  empty:     { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#666', height: '100%', background: '#2A2A2A' },
  hint:      { padding: '4px 12px', background: '#222', color: '#555', fontSize: '0.68rem', textAlign: 'center', flexShrink: 0 },
}
