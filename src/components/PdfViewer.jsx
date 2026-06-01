import { useEffect, useRef, useState, useCallback } from 'react'

// Escala de renderizado alto (nítido en cualquier zoom razonable)
const RENDER_SCALE = 2.5
// Zoom CSS inicial — ajustamos al cargar para que el PDF entre en el contenedor
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4

export default function PdfViewer({ url }) {
  const scrollRef    = useRef(null)   // contenedor con scroll
  const wrapperRef   = useRef(null)   // wrapper de páginas (al que aplicamos zoom)
  const pdfRef       = useRef(null)
  const baseSizesRef = useRef([])     // tamaños naturales de cada página (width, height) sin zoom
  const [zoom,       setZoom]       = useState(1)
  const zoomRef      = useRef(1)
  const [cargando,   setCargando]   = useState(true)
  const [error,      setError]      = useState(null)

  // Render todas las páginas a alta resolución
  const renderizarTodo = useCallback(async (pdf) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    wrapper.innerHTML = ''
    baseSizesRef.current = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const vp   = page.getViewport({ scale: RENDER_SCALE })

      // Tamaño "real" del PDF en pantalla (sin zoom CSS) — vp dividido por escala render
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
      wrapper.appendChild(canvas)

      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport: vp }).promise
    }

    // Ajustar zoom inicial para que la primera página entre en el contenedor
    const scrollEl = scrollRef.current
    if (scrollEl && baseSizesRef.current[0]) {
      const containerW = scrollEl.clientWidth - 32  // padding
      const pageW      = baseSizesRef.current[0].w
      const fitZoom    = Math.min(1, containerW / pageW)
      zoomRef.current  = fitZoom
      setZoom(fitZoom)
      aplicarZoom(fitZoom)
    }

    setCargando(false)
  }, [])

  // Aplica el zoom CSS al wrapper (sin re-renderizar canvas)
  function aplicarZoom(z) {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    // Ajustar el tamaño de cada canvas con el zoom
    const canvases = wrapper.querySelectorAll('canvas')
    canvases.forEach((c, i) => {
      const size = baseSizesRef.current[i]
      if (size) {
        c.style.width  = (size.w * z) + 'px'
        c.style.height = (size.h * z) + 'px'
      }
    })
  }

  // Cargar PDF
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
        await renderizarTodo(pdf)
      } catch (e) {
        if (!cancelled) { console.error(e); setError('No se pudo cargar el PDF') }
      }
    }
    cargar()
    return () => { cancelled = true }
  }, [url, renderizarTodo])

  // Wheel handler — zoom centrado donde está el cursor
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    function onWheel(e) {
      // Solo interceptamos si NO es scroll normal (ctrl/cmd o sin shift)
      // En realidad queremos zoom siempre con la rueda en este componente
      e.preventDefault()

      const oldZoom = zoomRef.current
      const factor  = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor))
      if (newZoom === oldZoom) return

      // Posición del cursor relativa al contenido (no al viewport)
      const rect          = scrollEl.getBoundingClientRect()
      const mouseX        = e.clientX - rect.left
      const mouseY        = e.clientY - rect.top
      const scrollLeft    = scrollEl.scrollLeft
      const scrollTop     = scrollEl.scrollTop
      // Punto del contenido que está bajo el cursor (en coords sin zoom)
      const contentX = (scrollLeft + mouseX) / oldZoom
      const contentY = (scrollTop  + mouseY) / oldZoom

      zoomRef.current = newZoom
      setZoom(newZoom)
      aplicarZoom(newZoom)

      // Después del zoom, ajustar scroll para que el mismo punto siga bajo el cursor
      requestAnimationFrame(() => {
        scrollEl.scrollLeft = contentX * newZoom - mouseX
        scrollEl.scrollTop  = contentY * newZoom - mouseY
      })
    }

    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    return () => scrollEl.removeEventListener('wheel', onWheel)
  }, [])

  function zoomIn()  {
    const n = Math.min(MAX_ZOOM, zoomRef.current * 1.2)
    zoomRef.current = n; setZoom(n); aplicarZoom(n)
  }
  function zoomOut() {
    const n = Math.max(MIN_ZOOM, zoomRef.current / 1.2)
    zoomRef.current = n; setZoom(n); aplicarZoom(n)
  }
  function zoomReset() {
    const scrollEl = scrollRef.current
    if (!scrollEl || !baseSizesRef.current[0]) return
    const containerW = scrollEl.clientWidth - 32
    const pageW      = baseSizesRef.current[0].w
    const fitZoom    = Math.min(1, containerW / pageW)
    zoomRef.current  = fitZoom
    setZoom(fitZoom)
    aplicarZoom(fitZoom)
    scrollEl.scrollTop  = 0
    scrollEl.scrollLeft = 0
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
          <button onClick={zoomOut}  style={s.zoomBtn} title="Reducir">−</button>
          <span style={s.zoomLabel}>{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn}   style={s.zoomBtn} title="Ampliar">+</button>
          <button onClick={zoomReset} style={{ ...s.zoomBtn, fontSize: '0.68rem', padding: '3px 8px' }} title="Ajustar a ventana">⊡</button>
        </div>
      </div>

      <div ref={scrollRef} style={s.scrollArea}>
        {cargando && (
          <div style={s.loading}>
            <span style={{ fontSize: '1.4rem', color: '#888' }}>⟳</span>
            <span style={{ fontSize: '0.82rem', color: '#888' }}>Cargando…</span>
          </div>
        )}
        {error && <div style={s.errorBox}>{error}</div>}
        <div
          ref={wrapperRef}
          style={{ padding: '16px', display: cargando ? 'none' : 'block', minWidth: 'min-content' }}
        />
      </div>

      <div style={s.hint}>🖱 Rueda = zoom · Scroll para navegar</div>
    </div>
  )
}

const s = {
  wrapper:    { display: 'flex', flexDirection: 'column', height: '100%', background: '#2A2A2A' },
  header:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#3A3A3A', borderBottom: '1px solid #555', flexShrink: 0 },
  headerLabel:{ color: '#ccc', fontSize: '0.75rem', fontWeight: 600 },
  zoomBtn:    { background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 10px', fontSize: '0.95rem', cursor: 'pointer', lineHeight: 1, minWidth: '26px' },
  zoomLabel:  { color: '#ccc', fontSize: '0.72rem', minWidth: '42px', textAlign: 'center' },
  scrollArea: { flex: 1, overflow: 'auto', position: 'relative', background: '#2A2A2A' },
  loading:    { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  errorBox:   { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E2401B', fontSize: '0.85rem' },
  empty:      { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#2A2A2A' },
  hint:       { padding: '4px 12px', background: '#222', color: '#555', fontSize: '0.68rem', textAlign: 'center', flexShrink: 0 },
}
