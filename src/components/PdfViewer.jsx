import { useEffect, useRef, useState, useCallback } from 'react'

export default function PdfViewer({ url }) {
  const containerRef = useRef(null)
  const canvasesRef  = useRef([])       // un canvas por página
  const pdfRef       = useRef(null)
  const scaleRef     = useRef(1.2)      // zoom actual
  const BASE_SCALE   = 1.2             // escala base de renderizado (nítido)
  const offsetRef    = useRef({ x: 0, y: 0 })
  const draggingRef  = useRef(false)
  const lastPosRef   = useRef({ x: 0, y: 0 })
  const cssScaleRef  = useRef(1)        // multiplicador CSS encima del render

  const [paginas,  setPaginas]  = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState(null)

  // Renderiza todas las páginas a BASE_SCALE en sus canvas
  const renderizarTodo = useCallback(async (pdf) => {
    const total = pdf.numPages
    setPaginas(total)
    canvasesRef.current = []

    const container = containerRef.current
    if (!container) return

    // Limpiar contenedor
    const wrapper = container.querySelector('#pdf-pages')
    if (!wrapper) return
    wrapper.innerHTML = ''

    for (let i = 1; i <= total; i++) {
      const page = await pdf.getPage(i)
      const vp   = page.getViewport({ scale: BASE_SCALE })

      const canvas        = document.createElement('canvas')
      canvas.width        = vp.width
      canvas.height       = vp.height
      canvas.style.display     = 'block'
      canvas.style.marginBottom = '12px'
      canvas.style.boxShadow   = '0 2px 12px rgba(0,0,0,0.5)'
      canvas.style.background  = '#fff'

      wrapper.appendChild(canvas)
      canvasesRef.current.push(canvas)

      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport: vp }).promise
    }

    setCargando(false)
    aplicarTransform()
  }, [])

  // Aplica zoom CSS + pan al wrapper de páginas
  function aplicarTransform() {
    const wrapper = containerRef.current?.querySelector('#pdf-pages')
    if (!wrapper) return
    const { x, y } = offsetRef.current
    wrapper.style.transform       = `translate(${x}px, ${y}px) scale(${cssScaleRef.current})`
    wrapper.style.transformOrigin = '0 0'
  }

  // Cargar PDF
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setCargando(true)
    setError(null)
    offsetRef.current  = { x: 0, y: 0 }
    cssScaleRef.current = 1

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
        await renderizarTodo(pdf)
      } catch (e) {
        if (!cancelled) { console.error(e); setError('No se pudo cargar el PDF') }
      }
    }
    cargar()
    return () => { cancelled = true }
  }, [url, renderizarTodo])

  // Zoom con rueda — centrado en posición del cursor
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function onWheel(e) {
      e.preventDefault()
      const delta    = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = Math.max(0.3, Math.min(5, cssScaleRef.current * delta))

      const wrapper = container.querySelector('#pdf-pages')
      if (!wrapper) return
      const rect   = wrapper.getBoundingClientRect()
      const mouseX = e.clientX - container.getBoundingClientRect().left
      const mouseY = e.clientY - container.getBoundingClientRect().top

      // Ajustar offset para que el zoom sea centrado en el cursor
      const factor = newScale / cssScaleRef.current
      offsetRef.current = {
        x: mouseX - factor * (mouseX - offsetRef.current.x),
        y: mouseY - factor * (mouseY - offsetRef.current.y),
      }

      cssScaleRef.current = newScale
      aplicarTransform()
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // Pan con drag
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

  if (!url) return (
    <div style={s.empty}>
      <div style={{ fontSize: '2.5rem', opacity: 0.2, marginBottom: '8px' }}>📄</div>
      <span style={{ fontSize: '0.82rem', color: '#666' }}>Sin documento adjunto</span>
    </div>
  )

  return (
    <div style={s.wrapper}>
      <div style={s.header}>
        <span style={s.headerLabel}>📄 Documento original</span>
        <span style={s.hint}>🖱 Rueda = zoom · Arrastrar = mover</span>
      </div>

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
            <span style={{ fontSize: '1.4rem', color: '#888' }}>⟳</span>
            <span style={{ fontSize: '0.82rem', color: '#888' }}>Cargando…</span>
          </div>
        )}
        {error && (
          <div style={s.errorBox}>{error}</div>
        )}
        {/* Wrapper de páginas — aquí se aplica transform */}
        <div id="pdf-pages" style={{ position: 'absolute', top: '16px', left: '16px', transformOrigin: '0 0' }} />
      </div>
    </div>
  )
}

const s = {
  wrapper:  { display: 'flex', flexDirection: 'column', height: '100%', background: '#2A2A2A' },
  header:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px', background: '#3A3A3A', borderBottom: '1px solid #555', flexShrink: 0 },
  headerLabel:{ color: '#ccc', fontSize: '0.75rem', fontWeight: 600 },
  hint:     { color: '#666', fontSize: '0.68rem' },
  viewport: { flex: 1, position: 'relative', overflow: 'hidden', cursor: 'grab', background: '#2A2A2A' },
  loading:  { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  errorBox: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E2401B', fontSize: '0.85rem' },
  empty:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#2A2A2A' },
}
