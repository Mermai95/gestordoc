import { useEffect, useRef, useState, useCallback } from 'react'

const RENDER_SCALE = 2.5
const MIN_ZOOM = 0.25
const MAX_ZOOM = 5

export default function PdfViewer({ url }) {
  const containerRef = useRef(null)  // div exterior — overflow:hidden, NO scroll
  const wrapperRef   = useRef(null)  // div interior — se mueve con transform
  const pdfRef       = useRef(null)
  const baseSizesRef = useRef([])
  const stateRef     = useRef({ zoom: 1, x: 0, y: 0 })  // estado sin re-render
  const draggingRef  = useRef(false)
  const dragStartRef = useRef({ mx: 0, my: 0, ox: 0, oy: 0 })
  const [zoom, setZoom] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState(null)

  function applyTransform() {
    const w = wrapperRef.current
    if (!w) return
    const { zoom: z, x, y } = stateRef.current
    w.style.transform = `translate(${x}px, ${y}px) scale(${z})`
    w.style.transformOrigin = '0 0'
  }

  function applyZoom(newZoom, pivotX, pivotY) {
    // pivotX/Y en coordenadas del contenedor
    const old  = stateRef.current
    const factor = newZoom / old.zoom
    stateRef.current = {
      zoom: newZoom,
      x: pivotX - factor * (pivotX - old.x),
      y: pivotY - factor * (pivotY - old.y),
    }
    setZoom(newZoom)
    applyTransform()
  }

  const renderizarTodo = useCallback(async (pdf) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    wrapper.innerHTML = ''
    baseSizesRef.current = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const vp   = page.getViewport({ scale: RENDER_SCALE })
      const baseW = vp.width  / RENDER_SCALE
      const baseH = vp.height / RENDER_SCALE
      baseSizesRef.current.push({ w: baseW, h: baseH })

      const canvas        = document.createElement('canvas')
      canvas.width        = vp.width
      canvas.height       = vp.height
      canvas.style.width  = baseW + 'px'
      canvas.style.height = baseH + 'px'
      canvas.style.display       = 'block'
      canvas.style.marginBottom  = '16px'
      canvas.style.boxShadow     = '0 4px 16px rgba(0,0,0,0.4)'
      canvas.style.background    = '#fff'
      canvas.style.pointerEvents = 'none'
      wrapper.appendChild(canvas)

      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport: vp }).promise
    }

    // Zoom inicial para que el PDF entre en el contenedor
    const container = containerRef.current
    if (container && baseSizesRef.current[0]) {
      const cw     = container.clientWidth  - 32
      const ch     = container.clientHeight - 32
      const { w, h } = baseSizesRef.current[0]
      const fitZ   = Math.min(1, cw / w, ch / h)
      stateRef.current = { zoom: fitZ, x: 16, y: 16 }
      setZoom(fitZ)
      applyTransform()
    }
    setCargando(false)
  }, [])

  // Cargar PDF
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setCargando(true); setError(null)
    stateRef.current = { zoom: 1, x: 0, y: 0 }
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

  // ZOOM con rueda — bloquear scroll completamente, solo zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e) {
      e.preventDefault()
      e.stopPropagation()
      function onWheel(e) {
      e.preventDefault()
      e.stopPropagation()
      console.log('wheel', e.deltaY)
      const oldZ   = stateRef.current.zoom
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const newZ   = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZ * factor))
      if (newZ === oldZ) return
      const rect   = el.getBoundingClientRect()
      const pivotX = e.clientX - rect.left
      const pivotY = e.clientY - rect.top
      applyZoom(newZ, pivotX, pivotY)
    }
    // capture:true para interceptar antes de cualquier scroll
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [])

  // PAN con drag
  function onMouseDown(e) {
    if (e.button !== 0) return
    draggingRef.current = true
    dragStartRef.current = {
      mx: e.clientX, my: e.clientY,
      ox: stateRef.current.x,
      oy: stateRef.current.y,
    }
    e.currentTarget.style.cursor = 'grabbing'
    e.preventDefault()
  }
  function onMouseMove(e) {
    if (!draggingRef.current) return
    const dx = e.clientX - dragStartRef.current.mx
    const dy = e.clientY - dragStartRef.current.my
    stateRef.current.x = dragStartRef.current.ox + dx
    stateRef.current.y = dragStartRef.current.oy + dy
    applyTransform()
  }
  function onMouseUp(e) {
    draggingRef.current = false
    if (e.currentTarget) e.currentTarget.style.cursor = 'grab'
  }

  function zoomIn()  { const n = Math.min(MAX_ZOOM, stateRef.current.zoom * 1.2); applyZoom(n, containerRef.current.clientWidth/2, containerRef.current.clientHeight/2) }
  function zoomOut() { const n = Math.max(MIN_ZOOM, stateRef.current.zoom / 1.2); applyZoom(n, containerRef.current.clientWidth/2, containerRef.current.clientHeight/2) }
  function zoomReset() {
    const container = containerRef.current
    if (!container || !baseSizesRef.current[0]) return
    const cw = container.clientWidth  - 32
    const ch = container.clientHeight - 32
    const { w, h } = baseSizesRef.current[0]
    const fitZ = Math.min(1, cw / w, ch / h)
    stateRef.current = { zoom: fitZ, x: 16, y: 16 }
    setZoom(fitZ)
    applyTransform()
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={zoomOut}   style={s.zoomBtn}>−</button>
          <span style={s.zoomLabel}>{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn}    style={s.zoomBtn}>+</button>
          <button onClick={zoomReset} style={{ ...s.zoomBtn, fontSize: '0.68rem', padding: '3px 8px' }}>⊡</button>
        </div>
      </div>

      {/* overflow:hidden — sin scroll, sin escape de eventos */}
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
        {error && <div style={s.errorBox}>{error}</div>}
        <div
          ref={wrapperRef}
          style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', display: cargando ? 'none' : 'block', padding: '16px' }}
        />
      </div>

      <div style={s.hint}>🖱 Rueda = zoom · Arrastrar = mover</div>
    </div>
  )
}

const s = {
  wrapper:    { display: 'flex', flexDirection: 'column', height: '100%', background: '#2A2A2A' },
  header:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#3A3A3A', borderBottom: '1px solid #555', flexShrink: 0 },
  headerLabel:{ color: '#ccc', fontSize: '0.75rem', fontWeight: 600 },
  zoomBtn:    { background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 10px', fontSize: '0.95rem', cursor: 'pointer', lineHeight: 1, minWidth: '26px' },
  zoomLabel:  { color: '#ccc', fontSize: '0.72rem', minWidth: '42px', textAlign: 'center' },
  viewport:   { flex: 1, position: 'relative', overflow: 'hidden', cursor: 'grab', background: '#2A2A2A', userSelect: 'none' },
  loading:    { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  errorBox:   { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E2401B', fontSize: '0.85rem' },
  empty:      { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#2A2A2A' },
  hint:       { padding: '4px 12px', background: '#222', color: '#555', fontSize: '0.68rem', textAlign: 'center', flexShrink: 0 },
}